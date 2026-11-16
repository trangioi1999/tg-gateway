import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { crc32 } from "../src/protocol.ts";
function frame(type, data) {
  const enc = new TextEncoder(),
    headers = [];
  for (const [name, value] of Object.entries({
    ":event-type": type,
    ":message-type": "event",
  })) {
    const n = enc.encode(name),
      v = enc.encode(value);
    headers.push(n.length, ...n, 7, 0, v.length, ...v);
  }
  const payload = enc.encode(JSON.stringify(data)),
    bytes = new Uint8Array(16 + headers.length + payload.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  view.setUint32(4, headers.length);
  view.setUint32(8, crc32(bytes.slice(0, 8)));
  bytes.set(headers, 12);
  bytes.set(payload, 12 + headers.length);
  view.setUint32(bytes.length - 4, crc32(bytes.slice(0, -4)));
  return [...bytes];
}
const content = frame("assistantResponseEvent", { content: "Hello world" }),
  meter = frame("meteringEvent", { usage: 0.125 });
const upstream = `export default {async fetch(request){const payload=await request.json();const text=payload.conversationState.currentMessage.userInputMessage.content;if(text==='rate-limit')return new Response('private upstream body',{status:429});const bytes=new Uint8Array([...${JSON.stringify(content)},...(text==='truncated'?[]:${JSON.stringify(meter)})]);return new Response(bytes,{headers:{'Content-Type':'application/vnd.amazon.eventstream'}});}};`;
test("real Worker + SQLite: auth, metering, streaming, immutable rates, errors and CSV", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "gateway",
          modules: true,
          scriptPath: "dist/index.js",
          compatibilityDate: "2026-11-01",
          compatibilityFlags: ["nodejs_compat"],
          durableObjects: {
            GATEWAY: { className: "Gateway", useSQLite: true },
          },
          outboundService: "upstream",
          bindings: {
            ADMIN_PASSWORD: "admin-test-password",
            GATEWAY_API_KEY: "gateway-test-key",
            SESSION_SECRET: "test-secret",
            VAULT_KEY: "a".repeat(64),
            KIRO_CREDENTIALS: JSON.stringify({
              refreshToken: "test",
              accessToken: "access",
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            }),
          },
        },
        {
          name: "upstream",
          modules: true,
          script: upstream,
          compatibilityDate: "2026-11-01",
        },
      ],
    }),
  );
  const base = "https://gateway.test";
  let cookie = "";
  const send = (path, options = {}) =>
    mf.dispatchFetch(base + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
        ...options.headers,
      },
    });
  try {
    assert.equal((await send("/api/settings")).status, 401);
    const login = await send("/api/session", {
      method: "POST",
      body: JSON.stringify({ password: "admin-test-password" }),
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie").split(";")[0];
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);
    assert.match(login.headers.get("set-cookie"), /Secure/);
    let s = (await (await send("/api/settings")).json()).settings;
    assert.equal(
      (
        await send("/api/settings", {
          method: "PUT",
          headers: { Origin: "https://evil.test" },
          body: JSON.stringify(s),
        })
      ).status,
      403,
    );
    s = { ...s, inputCreditsPerMillion: 100, outputCreditsPerMillion: 200 };
    assert.equal(
      (await send("/api/settings", { method: "PUT", body: JSON.stringify(s) }))
        .status,
      200,
    );
    const chat = (text, stream = false, anthropic = false) =>
      send(anthropic ? "/v1/messages" : "/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer gateway-test-key" },
        body: JSON.stringify({
          model: "claude-sonnet-4.5",
          messages: [{ role: "user", content: text }],
          stream,
          stream_options: { include_usage: true },
        }),
      });
    const completion = await chat("hello");
    assert.equal(completion.status, 200);
    assert.equal(
      (await completion.json()).choices[0].message.content,
      "Hello world",
    );
    const before = await (await send("/api/requests")).json();
    assert.equal(before.total, 1);
    assert.equal(before.items[0].reported_credits, 0.125);
    assert.ok(before.items[0].estimated_credits > 0);
    const firstCredits = before.items[0].estimated_credits;
    s.inputCreditsPerMillion = 900;
    await send("/api/settings", { method: "PUT", body: JSON.stringify(s) });
    const stream = await chat("hello", true);
    const streamText = await stream.text();
    assert.match(streamText, /Hello world/);
    assert.match(streamText, /\[DONE\]/);
    const anthropic = await chat("hello", true, true);
    assert.match(await anthropic.text(), /message_stop/);
    // Clean end of stream without metering: answer is delivered, ledger flags it.
    const quiet = await chat("truncated", true);
    const quietText = await quiet.text();
    assert.match(quietText, /Hello world/);
    assert.match(quietText, /\[DONE\]/);
    // Request shaped like Claude Code 2.1.x (captured): thinking + temperature, system blocks
    // with cache_control, metadata, context_management, tools and a tool round-trip.
    const claudeCode = await send("/v1/messages?beta=true", {
      method: "POST",
      headers: {
        "x-api-key": "gateway-test-key",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "claude-code-20250219",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 32000,
        temperature: 1,
        thinking: { type: "enabled", budget_tokens: 31999 },
        context_management: { edits: [] },
        metadata: { user_id: "test" },
        stream: true,
        system: [
          { type: "text", text: "You are Claude Code." },
          { type: "text", text: "Be brief.", cache_control: { type: "ephemeral" } },
        ],
        tools: [
          {
            name: "Bash",
            description: "Run a command",
            input_schema: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
            },
          },
        ],
        messages: [
          { role: "user", content: [{ type: "text", text: "list files" }] },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Running ls." },
              { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: [{ type: "text", text: "README.md" }],
              },
              { type: "text", text: "summarize", cache_control: { type: "ephemeral" } },
            ],
          },
        ],
      }),
    });
    assert.equal(claudeCode.status, 200);
    assert.equal(
      claudeCode.headers.get("x-gateway-ignored-params"),
      "thinking,temperature",
    );
    const claudeCodeText = await claudeCode.text();
    assert.match(claudeCodeText, /message_stop/);
    const start = JSON.parse(
      claudeCodeText.match(/event: message_start\ndata: (.*)/)[1],
    );
    assert.ok(start.message.usage.input_tokens > 0);
    const limited = await chat("rate-limit");
    assert.equal(limited.status, 429);
    assert.ok(!(await limited.text()).includes("private upstream body"));
    const rows = await (await send("/api/requests")).json();
    assert.equal(rows.total, 6);
    assert.equal(
      rows.items.find((r) => r.id === before.items[0].id).estimated_credits,
      firstCredits,
    );
    assert.equal(rows.items.filter((r) => r.status === 200).length, 5);
    assert.equal(rows.items.filter((r) => r.status >= 400).length, 1);
    assert.equal(
      rows.items.filter((r) => r.error_code === "no_completion_signal").length,
      1,
    );
    assert.equal(
      rows.items.find((r) => r.endpoint === "/v1/messages" && r.model).model,
      "claude-sonnet-4.5",
    );
    const totals = (await (await send("/api/overview")).json()).totals;
    assert.equal(totals.reported_credits, 0.5);
    assert.equal(totals.reported_requests, 4);
    const exported = await send("/api/export");
    assert.equal(
      exported.headers.get("content-type"),
      "text/csv; charset=utf-8",
    );
    assert.match(await exported.text(), /input_rate/);
    s.enabled = false;
    await send("/api/settings", { method: "PUT", body: JSON.stringify(s) });
    assert.equal((await chat("hello")).status, 503);
    await send("/api/session", { method: "DELETE" });
    cookie = "";
    assert.equal((await send("/api/overview")).status, 401);
  } finally {
    await mf.dispose();
  }
});
