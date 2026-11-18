import { HttpError, type Env } from "../types.ts";
import type { ApiMode } from "../stream.ts";
import type { Gateway } from "../gateway.ts";
import type { OverviewResponse, ProviderQuota, ProvidersResponse, ProviderId, RequestDetail, RequestRow, Step } from "./contract.ts";
import { parsePeriod, periodRange } from "./period.ts";
import { totals, grouped } from "../db/stats.ts";
import { fetchKiroUsage, fetchOpenRouterCredits } from "../upstream/quota.ts";

export const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export function failure(
  error: unknown,
  id?: string,
  mode: ApiMode = "openai",
  billed = false,
) {
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
    {
      ...(id ? { "x-request-id": id } : {}),
      // Upstream already charged for this answer: tell SDK clients not to resend it.
      ...(billed ? { "x-should-retry": "false" } : {}),
    },
  );
}
const PROVIDERS: readonly ProviderId[] = ["kiro", "anthropic", "openrouter", "deploy"];
/** `provider` query param: absent or "all" = no filter. */
function providerFilter(url: URL): ProviderId | undefined {
  const value = url.searchParams.get("provider");
  if (value === null || value === "all") return undefined;
  if (!(PROVIDERS as readonly string[]).includes(value))
    throw new HttpError(400, "invalid_filter", "Unknown provider filter.");
  return value as ProviderId;
}
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export function overview(gw: Gateway, url: URL) {
  const range = parsePeriod(url);
  const provider = providerFilter(url);
  // parsePeriod already validated tz.
  const tz = Number(url.searchParams.get("tz") ?? 0);
  const monthRange = periodRange("month", ymd(range.from + tz * 60_000), tz);
  const body: OverviewResponse = {
    range,
    totals: totals(gw.sql, range.from, range.to, provider),
    previous: totals(gw.sql, range.previousFrom, range.previousTo, provider),
    month: totals(gw.sql, monthRange.from, monthRange.to, provider),
    byProvider: grouped(gw.sql, range.from, range.to, "provider", provider) as unknown as OverviewResponse["byProvider"],
    models: grouped(gw.sql, range.from, range.to, "model", provider) as unknown as OverviewResponse["models"],
    clients: grouped(gw.sql, range.from, range.to, "client", provider) as unknown as OverviewResponse["clients"],
    active: gw.sql
      .exec<{ n: number }>("SELECT COUNT(*) n FROM requests WHERE status=0")
      .one().n,
    settings: gw.settings(),
    generatedAt: Date.now(),
  };
  return json(body);
}
function filter(url: URL) {
  const range = parsePeriod(url);
  const provider = providerFilter(url);
  let clause = "started>=? AND started<?";
  const args: (string | number)[] = [range.from, range.to];
  if (provider) {
    clause += " AND provider=?";
    args.push(provider);
  }
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
  const q = url.searchParams.get("q")?.trim();
  if (q) {
    if (q.length > 200) throw new HttpError(400, "invalid_filter", "Search text is too long.");
    const like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    clause += ` AND (${["client", "model", "ip", "error_code", "agent", "claude_session", "kiro_conversation"].map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`;
    args.push(like, like, like, like, like, like, like);
  }
  return { clause, args, range, provider };
}
export function requests(gw: Gateway, url: URL) {
  const page = Number(url.searchParams.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new HttpError(400, "invalid_page", "Invalid page.");
  const pageSize = Number(url.searchParams.get("pageSize") ?? 10);
  if (![10, 25, 50, 100].includes(pageSize))
    throw new HttpError(400, "invalid_page", "Invalid page size.");
  const { clause, args, range, provider } = filter(url);
  const total = gw.sql
    .exec<{
      count: number;
    }>(`SELECT COUNT(*) count FROM requests WHERE ${clause}`, ...args)
    .one().count;
  return json({
    page,
    pageSize,
    total,
    range,
    summary: totals(gw.sql, range.from, range.to, provider),
    items: gw.sql
      .exec<Record<string, SqlStorageValue>>(
        `SELECT * FROM requests WHERE ${clause} ORDER BY started DESC,id DESC LIMIT ? OFFSET ?`,
        ...args,
        pageSize,
        (page - 1) * pageSize,
      )
      .toArray()
      .map((row) => withoutSteps(row)),
  });
}
/** The stored trace is only returned by the detail route, parsed. */
function withoutSteps(row: Record<string, SqlStorageValue>): RequestRow {
  const { steps: _, ...rest } = row;
  return rest as unknown as RequestRow;
}
/** `GET /api/requests/:id`: the row, its trace (live while in flight) and captured payload. */
export function detail(gw: Gateway, id: string, url?: URL) {
  const row = gw.sql
    .exec<Record<string, SqlStorageValue>>("SELECT * FROM requests WHERE id=?", id)
    .toArray()[0];
  if (!row) throw new HttpError(404, "not_found", "Unknown request.");
  const live = gw.traces.get(id);
  // Rows written before traces existed have no steps.
  const steps: Step[] = live ? live.steps() : JSON.parse((row.steps as string | null) ?? "[]");
  const saved = gw.sql
    .exec<{ request: string | null; response: string | null; truncated: number }>(
      "SELECT request,response,truncated FROM payloads WHERE id=?",
      id,
    )
    .toArray()[0];
  // `since`: characters of live output the viewer already has.
  const since = Math.max(0, Number(url?.searchParams.get("since")) || 0);
  const running = gw.running.get(id);
  const body: RequestDetail = {
    request: withoutSteps(row),
    steps,
    payload: saved ? { request: saved.request, response: saved.response, truncated: Boolean(saved.truncated) } : null,
    live: running ? { ...running.live.since(since), bytes: running.live.bytes } : null,
  };
  return json(body);
}
export function exportCsv(gw: Gateway, url: URL) {
  const { clause, args } = filter(url);
  const rows = gw.sql
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
    "agent",
    "claude_session",
    "kiro_conversation",
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

const QUOTA_TTL = 5 * 60_000;

/** Cache an answer unless an entry failed; `not_configured` is stable (vault save/reset clear the cache, secrets change only on redeploy). */
export const cacheable = (entries: ProviderQuota[]) => entries.every((p) => p.ok || p.error === "not_configured");

/** Run one provider's lookup; anything it throws becomes that entry's `ok:false` instead of failing the route. */
export async function safeEntry(
  id: ProviderId,
  unit: ProviderQuota["unit"],
  fn: () => ProviderQuota | Promise<ProviderQuota>,
): Promise<ProviderQuota> {
  try {
    return await fn();
  } catch (error) {
    return { id, configured: true, ok: false, error: error instanceof HttpError ? error.code : "fetch_failed", unit, fetchedAt: Date.now() };
  }
}

/** GET /api/providers: per-provider quota. Always 200; failures are per entry. Cached 5 minutes per tz/region/budget. */
export async function providers(gw: Gateway, env: Env, url: URL): Promise<Response> {
  const range = parsePeriod(new URL(`${url.origin}/?${new URLSearchParams({ period: "month", tz: url.searchParams.get("tz") ?? "0" })}`));
  const s = gw.settings();
  const key = `${range.from}|${s.apiRegion}|${s.anthropicMonthlyBudgetUsd}`;
  const hit = gw.quotaCache.get(key);
  const now = Date.now();
  if (url.searchParams.get("refresh") !== "1" && hit && now - hit.at < QUOTA_TTL) return json(hit.body);
  const cost = (provider: ProviderId) => totals(gw.sql, range.from, range.to, provider).cost_usd;
  const kiro = async (): Promise<ProviderQuota> => {
    const base: ProviderQuota = { id: "kiro", configured: false, ok: false, unit: "credit", fetchedAt: Date.now() };
    if ((await gw.auth.status()).source === "none") return { ...base, error: "not_configured" };
    base.configured = true;
    try {
      const credentials = await gw.auth.get();
      if (!credentials.accessToken) return { ...base, error: "bad_response" };
      const arn = await gw.auth.profileArn(s.apiRegion, s.kiroVersion);
      const r = await fetchKiroUsage(credentials.accessToken, s.apiRegion, arn, s.kiroVersion);
      return r.ok ? { ...base, ok: true, ...r.value, fetchedAt: Date.now() } : { ...base, error: r.error, fetchedAt: Date.now() };
    } catch (error) {
      return { ...base, error: error instanceof HttpError ? error.code : "fetch_failed" };
    }
  };
  const anthropic = (): ProviderQuota => {
    const configured = !!env.ANTHROPIC_API_KEY;
    return configured
      ? { id: "anthropic", configured, ok: true, unit: "usd", monthCostUsd: cost("anthropic"), budgetUsd: s.anthropicMonthlyBudgetUsd, fetchedAt: Date.now() }
      : { id: "anthropic", configured, ok: false, error: "not_configured", unit: "usd", fetchedAt: Date.now() };
  };
  const openrouter = async (): Promise<ProviderQuota> => {
    const base: ProviderQuota = { id: "openrouter", configured: !!env.OPENROUTER_API_KEY, ok: false, unit: "usd", fetchedAt: Date.now() };
    if (!env.OPENROUTER_API_KEY) return { ...base, error: "not_configured" };
    const r = await fetchOpenRouterCredits(env.OPENROUTER_API_KEY);
    return r.ok ? { ...base, ok: true, ...r.value, fetchedAt: Date.now() } : { ...base, error: r.error, fetchedAt: Date.now() };
  };
  const deploy = (): ProviderQuota => {
    const configured = !!env.DEPLOY_API_KEY;
    return configured
      ? { id: "deploy", configured, ok: true, unit: "usd", monthCostUsd: cost("deploy"), fetchedAt: Date.now() }
      : { id: "deploy", configured, ok: false, error: "not_configured", unit: "usd", fetchedAt: Date.now() };
  };
  const body: ProvidersResponse = { providers: await Promise.all([
    safeEntry("kiro", "credit", kiro),
    safeEntry("anthropic", "usd", anthropic),
    safeEntry("openrouter", "usd", openrouter),
    safeEntry("deploy", "usd", deploy),
  ]) };
  if (cacheable(body.providers)) {
    gw.quotaCache.set(key, { at: now, body });
    if (gw.quotaCache.size > 16) gw.quotaCache.delete(gw.quotaCache.keys().next().value!);
  }
  return json(body);
}
