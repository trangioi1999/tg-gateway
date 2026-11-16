import { DurableObject } from "cloudflare:workers";
import {
  defaults,
  validateSettings,
  HttpError,
  type Env,
  type Settings,
} from "./types.ts";
import {
  equal,
  makeSession,
  validSession,
  requireOrigin,
  readJson,
  digest,
} from "./security.ts";
import { prepare, Completion, credits, object } from "./protocol.ts";
import { KiroAuth } from "./kiro-auth.ts";
import { Formatter, consume, type ApiMode } from "./stream.ts";
import { detectClient } from "./clients.ts";
import {
  AnthropicMeter,
  toAnthropic,
  CompatStream,
  CompatUsage,
  fromUpstreamJson,
  providerKey,
  routeModel,
  toUpstream,
  PROVIDERS,
} from "./compat.ts";

const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
function failure(error: unknown, id?: string, mode: ApiMode = "openai") {
  const e =
    error instanceof HttpError
      ? error
      : new HttpError(
          500,
          "internal_error",
          "Request failed. Check gateway configuration.",
        );
  return json(
    {
      ...(mode === "anthropic" ? { type: "error" } : {}),
      error: { type: e.code, code: e.code, message: e.message },
      ...(id ? { request_id: id } : {}),
    },
    e.status,
    id ? { "x-request-id": id } : {},
  );
}
export class Gateway extends DurableObject<Env> {
  sql: SqlStorage;
  auth: KiroAuth;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.auth = new KiroAuth(ctx.storage, env);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)`,
    );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, started INTEGER NOT NULL, finished INTEGER, endpoint TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL DEFAULT 0, latency INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0, input_source TEXT NOT NULL DEFAULT 'unknown',output_source TEXT NOT NULL DEFAULT 'unknown',
      reported_credits REAL, estimated_credits REAL NOT NULL DEFAULT 0, input_rate REAL NOT NULL DEFAULT 0, output_rate REAL NOT NULL DEFAULT 0,
      error_code TEXT, context_percent REAL, streamed INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS requests_time ON requests(started)`,
    );
    // Columns added after v0.1. CREATE TABLE IF NOT EXISTS does not alter existing tables.
    const columns = new Set(
      this.sql
        .exec<{ name: string }>("PRAGMA table_info(requests)")
        .toArray()
        .map((c) => c.name),
    );
    if (!columns.has("client"))
      this.sql.exec(
        "ALTER TABLE requests ADD COLUMN client TEXT NOT NULL DEFAULT 'other'",
      );
    if (!columns.has("provider"))
      this.sql.exec(
        "ALTER TABLE requests ADD COLUMN provider TEXT NOT NULL DEFAULT 'kiro'",
      );
    if (!columns.has("cost_usd"))
      this.sql.exec("ALTER TABLE requests ADD COLUMN cost_usd REAL");
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)`,
    );
    this.sql.exec(
      `INSERT OR IGNORE INTO settings VALUES(1,?)`,
      JSON.stringify(defaults),
    );
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null)
        await ctx.storage.setAlarm(Date.now() + 3600_000);
    });
  }
  settings(): Settings {
    return JSON.parse(
      this.sql
        .exec<{ value: string }>("SELECT value FROM settings WHERE id=1")
        .one().value,
    );
  }
  limit(key: string, max: number) {
    const bucket = `${key}:${Math.floor(Date.now() / 60_000)}`;
    const row = this.sql
      .exec<{
        count: number;
      }>(`INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`, bucket, Date.now() + 120_000)
      .one();
    if (row.count > max)
      throw new HttpError(
        429,
        "rate_limit",
        "Too many requests. Try again next minute.",
      );
  }
  async alarm() {
    const now = Date.now();
    this.sql.exec("DELETE FROM limits WHERE expires < ?", now);
    this.sql.exec(
      "DELETE FROM requests WHERE started < ?",
      now - this.settings().retentionDays * 86400_000,
    );
    this.sql.exec(
      "UPDATE requests SET status=598,error_code='interrupted_unknown',finished=?,latency=?-started WHERE status=0 AND started<?",
      now,
      now,
      now - 15 * 60_000,
    );
    await this.ctx.storage.setAlarm(now + 3600_000);
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url),
      path = url.pathname;
    try {
      if (path === "/health" && request.method === "GET")
        return json({ ok: true, service: "tg-gateway" });
      if (path === "/api/session" && request.method === "POST") {
        requireOrigin(request);
        this.limit(
          "login:" +
            (await digest(request.headers.get("CF-Connecting-IP") ?? "local")),
          8,
        );
        if (!this.env.ADMIN_PASSWORD || !this.env.SESSION_SECRET)
          throw new HttpError(
            503,
            "setup_required",
            "Configure ADMIN_PASSWORD and SESSION_SECRET in Cloudflare Secrets.",
          );
        const body = await readJson(request, 4096);
        if (
          !object(body) ||
          typeof body.password !== "string" ||
          !(await equal(body.password, this.env.ADMIN_PASSWORD))
        )
          throw new HttpError(
            401,
            "invalid_login",
            "Incorrect admin password.",
          );
        return json({ ok: true }, 200, {
          "Set-Cookie": this.cookie(
            await makeSession(this.env.SESSION_SECRET, this.env.ADMIN_PASSWORD),
            url,
          ),
        });
      }
      if (path.startsWith("/api/")) {
        if (!(await this.isAdmin(request)))
          throw new HttpError(401, "unauthorized", "Sign in to the dashboard.");
        if (!["GET", "HEAD"].includes(request.method)) requireOrigin(request);
        if (path === "/api/session" && request.method === "GET")
          return json({ ok: true });
        if (path === "/api/session" && request.method === "DELETE")
          return json({ ok: true }, 200, {
            "Set-Cookie": this.cookie("", url, 0),
          });
        if (path === "/api/settings" && request.method === "GET")
          return json({
            settings: this.settings(),
            secrets: Object.fromEntries(
              [
                "ADMIN_PASSWORD",
                "GATEWAY_API_KEY",
                "SESSION_SECRET",
                "VAULT_KEY",
                "KIRO_CREDENTIALS",
                "OPENROUTER_API_KEY",
                "DEPLOY_API_KEY",
                "ANTHROPIC_API_KEY",
              ].map((k) => [k, Boolean(this.env[k as keyof Env])]),
            ),
          });
        if (path === "/api/settings" && request.method === "PUT") {
          const s = validateSettings(await readJson(request, 16384));
          this.sql.exec(
            "UPDATE settings SET value=? WHERE id=1",
            JSON.stringify(s),
          );
          return json({ settings: s });
        }
        if (path === "/api/vault/reset" && request.method === "POST") {
          if (
            this.sql
              .exec<{
                count: number;
              }>("SELECT COUNT(*) count FROM requests WHERE status=0")
              .one().count > 0 ||
            this.auth.inflight
          )
            throw new HttpError(
              409,
              "gateway_busy",
              "Wait for active requests to finish before resetting the vault.",
            );
          await this.auth.reset();
          return json({ ok: true });
        }
        if (path === "/api/overview" && request.method === "GET")
          return this.overview(url);
        if (path === "/api/requests" && request.method === "GET")
          return this.requests(url);
        if (path === "/api/export" && request.method === "GET")
          return this.export(url);
        throw new HttpError(404, "not_found", "Unknown dashboard route.");
      }
      if (path.startsWith("/v1/")) {
        if (!this.env.GATEWAY_API_KEY)
          throw new HttpError(
            503,
            "setup_required",
            "Set GATEWAY_API_KEY in Cloudflare Secrets.",
          );
        const key =
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          request.headers.get("x-api-key") ??
          "";
        if (!(await equal(key, this.env.GATEWAY_API_KEY)))
          throw new HttpError(401, "unauthorized", "Invalid gateway API key.");
        if (path === "/v1/models" && request.method === "GET")
          return json({
            object: "list",
            data: this.settings().models.map((id) => ({
              id,
              object: "model",
              created: 0,
              owned_by:
                PROVIDERS.find((p) => id.startsWith(p.prefix))?.id ?? "kiro",
            })),
          });
        if (
          ["/v1/chat/completions", "/v1/messages"].includes(path) &&
          request.method === "POST"
        )
          return await this.chat(
            request,
            path === "/v1/messages" ? "anthropic" : "openai",
          );
        throw new HttpError(
          404,
          "not_found",
          "Supported endpoints: /v1/models, /v1/chat/completions, /v1/messages.",
        );
      }
      throw new HttpError(404, "not_found", "Not found.");
    } catch (error) {
      return failure(
        error,
        undefined,
        path === "/v1/messages" ? "anthropic" : "openai",
      );
    }
  }
  cookie(token: string, url: URL, age = 8 * 3600) {
    return `kiro_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${url.protocol === "https:" ? "; Secure" : ""}`;
  }
  async isAdmin(request: Request) {
    const token = request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)kiro_session=([^;]+)/)?.[1];
    return Boolean(
      token &&
        this.env.SESSION_SECRET &&
        this.env.ADMIN_PASSWORD &&
        (await validSession(
          token,
          this.env.SESSION_SECRET,
          this.env.ADMIN_PASSWORD,
        )),
    );
  }
  range(url: URL) {
    const days = Number(url.searchParams.get("days") ?? 7);
    if (![1, 7, 30, 90].includes(days))
      throw new HttpError(400, "invalid_range", "Use days=1,7,30,90.");
    return { days, since: Date.now() - days * 86400_000 };
  }
  overview(url: URL) {
    const { days, since } = this.range(url);
    const aggregate = `COUNT(*) requests, COALESCE(SUM(status>=200 AND status<300),0) successful,
      COALESCE(SUM(status>=400),0) failed,COALESCE(SUM(status=0),0) active,
      COALESCE(SUM(input_tokens),0) input_tokens,COALESCE(SUM(output_tokens),0) output_tokens,
      COALESCE(SUM(estimated_credits),0) estimated_credits,SUM(reported_credits) reported_credits,
      COUNT(reported_credits) reported_requests,COALESCE(SUM(input_source='estimated' OR output_source='estimated'),0) estimated_token_requests,
      COALESCE(AVG(CASE WHEN finished IS NOT NULL THEN latency END),0) avg_latency`;
    const totals = this.sql
      .exec(`SELECT ${aggregate} FROM requests WHERE started>=?`, since)
      .one();
    const series = this.sql
      .exec(
        `SELECT strftime('%Y-%m-%d',started/1000,'unixepoch') day, ${aggregate} FROM requests WHERE started>=? GROUP BY day ORDER BY day`,
        since,
      )
      .toArray();
    const models = this.sql
      .exec(
        `SELECT model, ${aggregate} FROM requests WHERE started>=? AND model!='' GROUP BY model ORDER BY requests DESC`,
        since,
      )
      .toArray();
    const clients = this.sql
      .exec(
        `SELECT client, COUNT(*) requests, COALESCE(SUM(status>=400),0) failed,
          COALESCE(SUM(input_tokens+output_tokens),0) tokens, MAX(started) last_seen
          FROM requests WHERE started>=? GROUP BY client ORDER BY requests DESC`,
        since,
      )
      .toArray();
    const now = new Date(),
      monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const month = this.sql
      .exec(`SELECT ${aggregate} FROM requests WHERE started>=?`, monthStart)
      .one();
    return json({
      days,
      totals,
      series,
      models,
      clients,
      month,
      settings: this.settings(),
      retentionDays: this.settings().retentionDays,
      timezone: "UTC",
      generatedAt: Date.now(),
    });
  }
  filter(url: URL) {
    const { since } = this.range(url);
    let clause = "started>=?";
    const args: (string | number)[] = [since];
    const model = url.searchParams.get("model");
    if (model) {
      clause += " AND model=?";
      args.push(model);
    }
    const status = url.searchParams.get("status");
    if (status === "success") clause += " AND status BETWEEN 200 AND 299";
    else if (status === "error") clause += " AND status>=400";
    else if (status === "active") clause += " AND status=0";
    else if (status && status !== "all")
      throw new HttpError(400, "invalid_filter", "Unknown status filter.");
    return { clause, args };
  }
  requests(url: URL) {
    const page = Number(url.searchParams.get("page") ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new HttpError(400, "invalid_page", "Invalid page.");
    const { clause, args } = this.filter(url);
    const total = this.sql
      .exec<{
        count: number;
      }>(`SELECT COUNT(*) count FROM requests WHERE ${clause}`, ...args)
      .one().count;
    return json({
      page,
      pageSize: 25,
      total,
      items: this.sql
        .exec(
          `SELECT * FROM requests WHERE ${clause} ORDER BY started DESC,id DESC LIMIT 25 OFFSET ?`,
          ...args,
          (page - 1) * 25,
        )
        .toArray(),
    });
  }
  export(url: URL) {
    const { clause, args } = this.filter(url);
    const rows = this.sql
      .exec(
        `SELECT * FROM requests WHERE ${clause} ORDER BY started DESC LIMIT 5001`,
        ...args,
      )
      .toArray();
    if (rows.length > 5000)
      throw new HttpError(
        400,
        "export_too_large",
        "More than 5000 rows. Choose a shorter range or model filter.",
      );
    const columns = [
      "id",
      "started",
      "client",
      "provider",
      "model",
      "status",
      "latency",
      "input_tokens",
      "output_tokens",
      "input_source",
      "output_source",
      "estimated_credits",
      "reported_credits",
      "cost_usd",
      "input_rate",
      "output_rate",
      "error_code",
    ];
    const cell = (value: unknown) => {
      let text = String(value ?? "");
      if (/^[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    return new Response(
      [
        columns.join(","),
        ...rows.map((row) => columns.map((c) => cell(row[c])).join(",")),
      ].join("\r\n"),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="tg-gateway-requests.csv"',
          "Cache-Control": "no-store",
        },
      },
    );
  }
  async chat(request: Request, mode: ApiMode): Promise<Response> {
    const id = (mode === "openai" ? "chatcmpl-" : "msg_") + crypto.randomUUID(),
      started = Date.now(),
      s = this.settings();
    this.sql.exec(
      "INSERT INTO requests(id,started,endpoint,input_rate,output_rate,client) VALUES(?,?,?,?,?,?)",
      id,
      started,
      new URL(request.url).pathname,
      s.inputCreditsPerMillion,
      s.outputCreditsPerMillion,
      detectClient(request.headers),
    );
    let result: Completion | CompatUsage | undefined,
      recorded = false,
      sent = false;
    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort(new Error("timeout")),
      s.timeoutSeconds * 1000,
    );
    const cancel = () => abort.abort(new Error("client_disconnect"));
    request.signal.addEventListener("abort", cancel, { once: true });
    const finish = (status: number, code: string | null = null) => {
      if (recorded) return;
      recorded = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancel);
      result?.finalize();
      const input = sent ? (result?.inputTokens ?? 0) : 0,
        output = sent ? (result?.outputTokens ?? 0) : 0;
      this.sql.exec(
        `UPDATE requests SET finished=?,status=?,latency=?,input_tokens=?,output_tokens=?,input_source=?,output_source=?,reported_credits=?,estimated_credits=?,error_code=?,context_percent=?,cost_usd=? WHERE id=?`,
        Date.now(),
        status,
        Date.now() - started,
        input,
        output,
        sent ? (result?.inputSource ?? "unknown") : "unknown",
        sent ? (result?.outputSource ?? "unknown") : "unknown",
        result?.reportedCredits ?? null,
        credits(input, output, s),
        code,
        result?.contextPercent ?? null,
        result instanceof CompatUsage ? result.costUsd : null,
        id,
      );
    };
    const asError = (error: unknown) =>
      abort.signal.aborted
        ? new HttpError(
            request.signal.aborted ? 499 : 504,
            request.signal.aborted ? "client_disconnect" : "timeout",
            "Request interrupted or timed out.",
          )
        : error;
    try {
      if (!s.enabled)
        throw new HttpError(503, "gateway_paused", "Gateway is paused.");
      this.limit("gateway", s.requestsPerMinute);
      const raw = await readJson(request);
      const route = object(raw) ? routeModel(raw.model, s) : null;
      if (route?.provider.native) {
        // Real Anthropic API: forward the Messages request unchanged except for the model.
        this.sql.exec(
          "UPDATE requests SET model=?,provider=? WHERE id=?",
          route.publicModel,
          route.provider.id,
          id,
        );
        if (mode !== "anthropic")
          throw new HttpError(
            400,
            "invalid_request",
            "anthropic/ models are served on /v1/messages (Anthropic format) only.",
          );
        const forward = toAnthropic(
          raw,
          route,
          request.headers,
          providerKey(this.env, route.provider),
        );
        this.sql.exec(
          "UPDATE requests SET model=?,streamed=?,provider=? WHERE id=?",
          route.publicModel,
          Number(forward.stream),
          route.provider.id,
          id,
        );
        const usage = new CompatUsage(forward.estimatedInput);
        result = usage;
        const meter = new AnthropicMeter(usage);
        const response = await fetch(route.provider.url, {
          method: "POST",
          headers: forward.headers,
          body: forward.body,
          signal: abort.signal,
        });
        const headers: Record<string, string> = {
          "x-request-id": id,
          "x-gateway-provider": route.provider.id,
          "Cache-Control": "no-store",
        };
        if (!response.ok) {
          // Same dialect: relay Anthropic's own error so the client's retry logic applies.
          const status = response.status;
          const retryAfter = response.headers.get("retry-after");
          const text = await response.text();
          finish(status, "upstream_http_" + status);
          return new Response(text, {
            status,
            headers: {
              ...headers,
              "Content-Type":
                response.headers.get("content-type") ?? "application/json",
              ...(retryAfter ? { "retry-after": retryAfter } : {}),
            },
          });
        }
        sent = true;
        if (!forward.stream || !response.body) {
          const body = await response.json();
          meter.json(body);
          finish(200);
          return json(body, 200, headers);
        }
        const decoder = new TextDecoder();
        const relay = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            meter.observe(decoder.decode(chunk, { stream: true }));
            controller.enqueue(chunk);
          },
        });
        const task = response.body
          .pipeTo(relay.writable, { signal: abort.signal })
          .then(
            () =>
              finish(
                meter.stopped ? 200 : 502,
                meter.stopped ? null : "incomplete_stream",
              ),
            (error) => {
              const e = asError(error);
              finish(
                e instanceof HttpError ? e.status : 502,
                e instanceof HttpError ? e.code : "stream_error",
              );
            },
          );
        this.ctx.waitUntil(task);
        return new Response(relay.readable, {
          headers: {
            ...headers,
            "Content-Type": "text/event-stream; charset=utf-8",
            "X-Accel-Buffering": "no",
          },
        });
      }
      if (route) {
        // OpenAI-compatible provider (OpenRouter, deploy.com): no Kiro auth involved.
        const compat = toUpstream(raw, mode, route);
        this.sql.exec(
          "UPDATE requests SET model=?,streamed=?,provider=? WHERE id=?",
          route.publicModel,
          Number(compat.stream),
          route.provider.id,
          id,
        );
        const key = providerKey(this.env, route.provider);
        const usage = new CompatUsage(compat.estimatedInput);
        result = usage;
        const response = await fetch(route.provider.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: compat.stream ? "text/event-stream" : "application/json",
            ...(route.provider.id === "openrouter"
              ? { "X-Title": "tg-gateway" }
              : {}),
          },
          body: JSON.stringify(compat.payload),
          signal: abort.signal,
        });
        if (!response.ok) {
          const status = response.status;
          let detail = "";
          try {
            const data = (await response.json()) as Record<string, any>;
            if (typeof data?.error?.message === "string")
              detail = " " + data.error.message.slice(0, 300);
          } catch {}
          throw new HttpError(
            [400, 402, 404, 413, 429].includes(status) ? status : 502,
            "upstream_http_" + status,
            `${route.provider.label} returned HTTP ${status}.${detail}`,
          );
        }
        sent = true;
        const headers = {
          "x-request-id": id,
          "x-gateway-provider": route.provider.id,
          "Cache-Control": "no-store",
        };
        if (!compat.stream) {
          const body = fromUpstreamJson(
            await response.json(),
            mode,
            id,
            route.publicModel,
            usage,
          );
          finish(200);
          return json(body, 200, headers);
        }
        if (!response.body)
          throw new HttpError(502, "empty_upstream", "Upstream returned no body.");
        const converter = new CompatStream(
          mode,
          id,
          route.publicModel,
          usage,
          compat.includeUsage,
        );
        const transform = new TransformStream<Uint8Array, Uint8Array>(),
          writer = transform.writable.getWriter(),
          enc = new TextEncoder(),
          dec = new TextDecoder();
        let disconnected = false;
        writer.closed.catch(() => {
          disconnected = true;
          abort.abort();
        });
        const write = (text: string) =>
          text ? writer.write(enc.encode(text)) : Promise.resolve();
        const upstream = response.body.getReader();
        const task = (async () => {
          try {
            await write(converter.start());
            let bytes = 0;
            for (;;) {
              const { value, done } = await upstream.read();
              if (done) break;
              bytes += value.length;
              if (bytes > 16 * 1024 * 1024)
                throw new HttpError(502, "output_limit", "Upstream output exceeded 16 MiB.");
              await write(converter.feed(dec.decode(value, { stream: true })));
            }
            const closing = converter.feed(dec.decode()) + converter.end();
            finish(200);
            await write(closing);
          } catch (error) {
            const e = asError(error);
            const code = disconnected
              ? "client_disconnect"
              : e instanceof HttpError
                ? e.code
                : "stream_error";
            finish(disconnected ? 499 : e instanceof HttpError ? e.status : 502, code);
            if (!disconnected)
              await write(
                new Formatter(mode, id, route.publicModel).error(code),
              ).catch(() => {});
          } finally {
            await upstream.cancel().catch(() => {});
            await writer.close().catch(() => {});
          }
        })();
        this.ctx.waitUntil(task);
        return new Response(transform.readable, {
          headers: {
            ...headers,
            "Content-Type": "text/event-stream; charset=utf-8",
            "X-Accel-Buffering": "no",
          },
        });
      }
      const prepared = prepare(raw, mode, s);
      this.sql.exec(
        "UPDATE requests SET model=?,streamed=? WHERE id=?",
        prepared.model,
        Number(prepared.stream),
        id,
      );
      const auth = await this.auth.get();
      if (!auth.clientId && auth.profileArn)
        prepared.payload.profileArn = auth.profileArn;
      if (abort.signal.aborted)
        throw new HttpError(504, "timeout", "Request timed out.");
      result = new Completion(prepared.estimatedInput);
      const call = (token: string) =>
        fetch(
          `https://runtime.${s.apiRegion}.kiro.dev/generateAssistantResponse`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/x-amz-json-1.0",
              "x-amz-target":
                "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
              Accept: "application/vnd.amazon.eventstream",
              "User-Agent": `aws-sdk-js/1.0.27 KiroIDE-0.7.45-${this.ctx.id.toString()}`,
              "x-amz-user-agent": `aws-sdk-js/1.0.27 KiroIDE-0.7.45-${this.ctx.id.toString()}`,
              "x-amzn-codewhisperer-optout": "true",
              "x-amzn-kiro-agent-mode": "vibe",
              "amz-sdk-invocation-id": crypto.randomUUID(),
              "amz-sdk-request": "attempt=1; max=1",
            },
            body: JSON.stringify(prepared.payload),
            signal: abort.signal,
          },
        );
      let response = await call(auth.accessToken!);
      // Retry only an explicit authentication rejection, never a generated/partially streamed request.
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        response = await call(
          (await this.auth.get(auth.accessToken)).accessToken!,
        );
      }
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel();
        throw new HttpError(
          [400, 402, 429].includes(status) ? status : 502,
          "kiro_http_" + status,
          `Kiro returned HTTP ${status}.`,
        );
      }
      sent = true;
      const formatter = new Formatter(mode, id, prepared.model);
      const headers = {
        "x-request-id": id,
        "x-kiro-token-usage": "estimated-unless-reported",
        "Cache-Control": "no-store",
        ...(prepared.ignored.length
          ? { "x-gateway-ignored-params": prepared.ignored.join(",") }
          : {}),
      };
      // Success without metering/context events: answer delivered, flagged in the ledger.
      const unsignalled = (c: Completion) =>
        c.terminal ? null : "no_completion_signal";
      if (!prepared.stream) {
        await consume(response, prepared, result);
        finish(200, unsignalled(result));
        return json(formatter.json(result), 200, headers);
      }
      const transform = new TransformStream<Uint8Array, Uint8Array>(),
        writer = transform.writable.getWriter(),
        enc = new TextEncoder();
      let disconnected = false;
      writer.closed.catch(() => {
        disconnected = true;
        abort.abort();
      });
      const write = (text: string) => writer.write(enc.encode(text));
      const completion = result;
      const task = (async () => {
        try {
          await write(formatter.start(completion.inputTokens));
          await consume(response, prepared, completion, async (delta) => {
            if (delta.text) await write(formatter.text(delta.text));
            if (delta.tool) await write(formatter.tool(delta.tool));
          });
          finish(200, unsignalled(completion));
          await write(formatter.finish(completion, prepared.includeUsage));
        } catch (error) {
          const e = asError(error);
          const code = disconnected
            ? "client_disconnect"
            : e instanceof HttpError
              ? e.code
              : "stream_error";
          finish(
            disconnected ? 499 : e instanceof HttpError ? e.status : 502,
            code,
          );
          if (!disconnected) await write(formatter.error(code)).catch(() => {});
        } finally {
          await writer.close().catch(() => {});
        }
      })();
      this.ctx.waitUntil(task);
      return new Response(transform.readable, {
        headers: {
          ...headers,
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      const e = asError(error);
      finish(
        e instanceof HttpError ? e.status : 502,
        e instanceof HttpError ? e.code : "upstream_error",
      );
      return failure(
        e instanceof HttpError
          ? e
          : new HttpError(
              502,
              "upstream_error",
              "Could not complete the Kiro request.",
            ),
        id,
        mode,
      );
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const response =
      path.startsWith("/api/") || path.startsWith("/v1/") || path === "/health"
        ? await env.GATEWAY.get(env.GATEWAY.idFromName("primary")).fetch(
            request,
          )
        : await env.ASSETS.fetch(request);
    const secured = new Response(response.body, response);
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("Referrer-Policy", "no-referrer");
    secured.headers.set("X-Frame-Options", "DENY");
    secured.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (new URL(request.url).protocol === "https:")
      secured.headers.set("Strict-Transport-Security", "max-age=31536000");
    return secured;
  },
} satisfies ExportedHandler<Env>;
