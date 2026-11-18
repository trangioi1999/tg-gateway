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
// OpenAI-compatible providers: SSE with text, a tool call and usage; JSON when not streaming.
const compatSse = [
  { choices: [{ delta: { content: "Hi from " } }] },
  { choices: [{ delta: { content: "compat" } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "Bash", arguments: '{"command":' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }, finish_reason: "tool_calls" }] },
  { choices: [], usage: { prompt_tokens: 120, completion_tokens: 9, cost: 0.0004 } },
]
  .map((c) => "data: " + JSON.stringify(c) + "\n\n")
  .join("") + ": keep-alive\n\ndata: [DONE]\n\n";
const compatJson = { id: "x", object: "chat.completion", model: "deepseek-ai/deepseek-v4.1-flash-1017", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Deploy says hi" } }], usage: { prompt_tokens: 11, completion_tokens: 4 } };
const compat = `if(['openrouter.ai','api-cdn.deploy.com'].includes(new URL(request.url).hostname)){const key=request.headers.get('authorization');if(key!=='Bearer or-key'&&key!=='Bearer deploy-key')return Response.json({error:{message:'bad key'}},{status:401});const body=await request.json();if(body.model.startsWith('openrouter/')||body.model.startsWith('deploy/'))return Response.json({error:{message:'prefix leaked'}},{status:400});if(body.stream)return new Response(${JSON.stringify(compatSse)},{headers:{'Content-Type':'text/event-stream'}});return Response.json(${JSON.stringify(compatJson)});}`;
const anthropicSse = [
  { type: "message_start", message: { id: "msg_up", type: "message", role: "assistant", content: [], model: "claude-sonnet-5-5", usage: { input_tokens: 30, cache_read_input_tokens: 70, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Real Claude" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
  { type: "message_stop" },
]
  .map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n")
  .join("");
const native = `if(new URL(request.url).hostname==='api.anthropic.com'){if(request.headers.get('x-api-key')!=='sk-ant-test')return Response.json({type:'error',error:{type:'authentication_error',message:'bad key'}},{status:401});if(request.headers.get('anthropic-beta')!=='claude-code-20250219')return Response.json({type:'error',error:{type:'invalid_request_error',message:'beta not forwarded'}},{status:400});const body=await request.json();if(body.model!=='claude-sonnet-5-5')return Response.json({type:'error',error:{type:'invalid_request_error',message:'prefix leaked'}},{status:400});if(body.messages[0].content==='overloaded')return Response.json({type:'error',error:{type:'overloaded_error',message:'Overloaded'}},{status:529,headers:{'retry-after':'7'}});return new Response(${JSON.stringify(anthropicSse)},{headers:{'Content-Type':'text/event-stream'}});}`;
const quotaGets = `if(request.method==='POST'&&new URL(request.url).pathname==='/ListAvailableProfiles')return Response.json({profiles:[{arn:'arn:aws:codewhisperer:us-east-1:1:profile/T'}]});if(request.method==='GET'){const u=new URL(request.url);if(u.hostname==='q.us-east-1.amazonaws.com'&&u.pathname==='/getUsageLimits')return Response.json({subscriptionInfo:{subscriptionTitle:"KIRO PRO"},nextDateReset:1764547200,usageBreakdownList:[{resourceType:"CREDIT",currentUsageWithPrecision:235.4,usageLimitWithPrecision:2000}]});if(u.hostname==='openrouter.ai'&&u.pathname==='/api/v1/credits')return Response.json({data:{total_credits:30,total_usage:11.4}});}`;
const upstream = `export default {async fetch(request){${quotaGets}${native}${compat}const payload=await request.json();const text=payload.conversationState.currentMessage.userInputMessage.content;if(text==='rate-limit')return new Response('private upstream body',{status:429});const bytes=new Uint8Array([...${JSON.stringify(content)},...(text==='truncated'?[]:${JSON.stringify(meter)})]);return new Response(bytes,{headers:{'Content-Type':'application/vnd.amazon.eventstream'}});}};`;
function gateway(upstreamScript) {
  return new Miniflare(
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
            OPENROUTER_API_KEY: "or-key",
            DEPLOY_API_KEY: "deploy-key",
            ANTHROPIC_API_KEY: "sk-ant-test",
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
          script: upstreamScript,
          compatibilityDate: "2026-11-01",
        },
      ],
    }),
  );
}
test("real Worker + SQLite: auth, metering, streaming, immutable rates, errors and CSV", async () => {
  const mf = gateway(upstream);
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
    // Every request below must reach the fake Kiro; the response cache has its own test.
    s = { ...s, inputCreditsPerMillion: 100, outputCreditsPerMillion: 200, responseCacheSeconds: 0 };
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
    // OpenAI-compatible providers selected by model prefix.
    s.models = [
      ...s.models,
      "openrouter/deepseek/deepseek-chat-v3.1",
      "deploy/deepseek-ai/deepseek-v4.1-flash-1017",
      "anthropic/claude-sonnet-5-5",
    ];
    assert.equal(
      (await send("/api/settings", { method: "PUT", body: JSON.stringify(s) })).status,
      200,
    );
    const viaOpenRouter = await send("/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "gateway-test-key", "user-agent": "claude-cli/2.1.325 (external, cli)" },
      body: JSON.stringify({
        model: "openrouter/deepseek/deepseek-chat-v3.1",
        stream: true,
        max_tokens: 1000,
        thinking: { type: "enabled", budget_tokens: 2000 },
        tools: [{ name: "Bash", input_schema: { type: "object", properties: {} } }],
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    });
    assert.equal(viaOpenRouter.status, 200);
    assert.equal(viaOpenRouter.headers.get("x-gateway-provider"), "openrouter");
    const orText = await viaOpenRouter.text();
    assert.match(orText, /Hi from /);
    assert.match(orText, /"name":"Bash"/);
    assert.match(orText, /"stop_reason":"tool_use"/);
    assert.match(orText, /message_stop/);
    const viaDeploy = await send("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer gateway-test-key" },
      body: JSON.stringify({
        model: "deploy/deepseek-ai/deepseek-v4.1-flash-1017",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.3,
      }),
    });
    assert.equal(viaDeploy.status, 200);
    const deployBody = await viaDeploy.json();
    assert.equal(deployBody.choices[0].message.content, "Deploy says hi");
    assert.equal(deployBody.model, "deploy/deepseek-ai/deepseek-v4.1-flash-1017");
    // Real Anthropic API: passthrough with model swapped, betas forwarded, errors relayed.
    const realClaude = (content) =>
      send("/v1/messages", {
        method: "POST",
        headers: { "x-api-key": "gateway-test-key", "anthropic-version": "2023-06-01", "anthropic-beta": "claude-code-20250219" },
        body: JSON.stringify({ model: "anthropic/claude-sonnet-5-5", stream: true, max_tokens: 100, messages: [{ role: "user", content }] }),
      });
    const viaAnthropic = await realClaude("hi");
    assert.equal(viaAnthropic.status, 200);
    assert.equal(viaAnthropic.headers.get("x-gateway-provider"), "anthropic");
    const anthropicText = await viaAnthropic.text();
    assert.match(anthropicText, /Real Claude/);
    assert.match(anthropicText, /message_stop/);
    const overloaded = await realClaude("overloaded");
    assert.equal(overloaded.status, 529);
    assert.equal(overloaded.headers.get("retry-after"), "7");
    assert.equal((await overloaded.json()).error.type, "overloaded_error");
    const openaiToAnthropic = await send("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer gateway-test-key" },
      body: JSON.stringify({ model: "anthropic/claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(openaiToAnthropic.status, 400);
    const allRows = (await (await send("/api/requests?days=1")).json()).items;
    const anthropicRows = allRows.filter((r) => r.provider === "anthropic");
    assert.equal(anthropicRows.length, 3);
    const okRow = anthropicRows.find((r) => r.status === 200);
    assert.equal(okRow.input_tokens, 100);
    assert.equal(okRow.output_tokens, 5);
    assert.equal(anthropicRows.find((r) => r.status === 529).error_code, "upstream_http_529");
    const compatRows = allRows.filter((r) => r.provider === "openrouter" || r.provider === "deploy");
    assert.equal(compatRows.length, 2);
    const orRow = compatRows.find((r) => r.provider === "openrouter");
    assert.equal(orRow.status, 200);
    assert.equal(orRow.input_tokens, 120);
    assert.equal(orRow.input_source, "reported");
    assert.equal(orRow.cost_usd, 0.0004);
    assert.equal(orRow.client, "claude-code");
    assert.equal(compatRows.find((r) => r.provider === "deploy").output_tokens, 4);
    const models = await (await send("/v1/models", { headers: { Authorization: "Bearer gateway-test-key" } })).json();
    assert.equal(models.data.find((m) => m.id.startsWith("deploy/")).owned_by, "deploy");
    s.enabled = false;
    await send("/api/settings", { method: "PUT", body: JSON.stringify(s) });
    assert.equal((await chat("hello")).status, 503);
    // Stats are recorded once per finished request (backfill + live upserts do not double count).
    const totalsBeforeClear = (await (await send("/api/overview?period=day&tz=0")).json()).totals;
    const dayList = await (await send("/api/requests?period=day&tz=0")).json();
    const inFlight = (await (await send("/api/requests?period=day&tz=0&status=active")).json()).total;
    assert.equal(totalsBeforeClear.requests, dayList.total - inFlight);
    assert.equal(dayList.summary.requests, totalsBeforeClear.requests);
    assert.equal(typeof dayList.range.from, "number");
    const cleared = await (await send("/api/requests", { method: "DELETE" })).json();
    assert.ok(cleared.deleted >= allRows.length);
    assert.equal((await (await send("/api/requests?days=1")).json()).total, 0);
    const ov = await (await send("/api/overview?period=day&tz=0")).json();
    assert.ok(ov.totals.requests > 0, "stats survive history clearing");
    assert.equal(ov.totals.requests, totalsBeforeClear.requests);
    assert.ok(Array.isArray(ov.byProvider) && ov.byProvider.some((p) => p.provider === "kiro"));
    assert.equal(typeof ov.previous.requests, "number");
    assert.equal(ov.month.requests >= ov.totals.requests, true);
    assert.equal(ov.active, 0);
    assert.equal(
      (await (await send("/api/overview?period=day&tz=0&provider=anthropic")).json()).totals.requests,
      ov.byProvider.find((p) => p.provider === "anthropic").requests,
    );
    assert.equal((await send("/api/overview?provider=bogus")).status, 400);
    await send("/api/session", { method: "DELETE" });
    cookie = "";
    assert.equal((await send("/api/overview")).status, 401);
  } finally {
    await mf.dispose();
  }
});

// Fake Kiro that records every payload it receives (GET /calls on the same host lists them).
const recording = `const calls=[];export default {async fetch(request){if(request.method==='GET')return Response.json(calls);const payload=await request.json();calls.push(payload);if(!payload.conversationState)return Response.json({profiles:[]});const text=payload.conversationState.currentMessage.userInputMessage.content;if(text.includes('slow')){const body=new ReadableStream({async start(c){for(let i=0;i<4;i++){c.enqueue(new Uint8Array(${JSON.stringify(frame("assistantResponseEvent", { content: "." }))}));await new Promise(r=>setTimeout(r,3000));}c.enqueue(new Uint8Array(${JSON.stringify(meter)}));c.close();}});return new Response(body);}if(text.includes('broken-tool'))return new Response(new Uint8Array(${JSON.stringify(frame("toolUseEvent", { name: "Bash", toolUseId: "t1", input: '{"command":', stop: true }))}));return new Response(new Uint8Array([...${JSON.stringify(content)},...${JSON.stringify(meter)}]));}};`;
async function signedIn(mf) {
  const base = "https://gateway.test";
  const login = await mf.dispatchFetch(base + "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ password: "admin-test-password" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const send = (path, options = {}) =>
    mf.dispatchFetch(base + path, {
      ...options,
      headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie, Authorization: "Bearer gateway-test-key", ...options.headers },
    });
  const calls = async () => (await (await (await mf.getWorker("upstream")).fetch("https://q.us-east-1.amazonaws.com/calls")).json()).filter((p) => p.conversationState);
  return { send, calls };
}
test("credit savers: local 1-token reply, idle timeout, no retry after billing, tool result clearing", async () => {
  const mf = gateway(recording);
  try {
    const { send, calls } = await signedIn(mf);
    let s = (await (await send("/api/settings")).json()).settings;
    const put = (next) => send("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    const message = (content, extra = {}) =>
      send("/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "claude-haiku-4.5", max_tokens: 4096, messages: [{ role: "user", content }], ...extra }),
      });
    // Claude Code's quota probe never reaches Kiro.
    const probe = await message("quota", { max_tokens: 1 });
    assert.equal(probe.status, 200);
    assert.equal((await probe.json()).stop_reason, "max_tokens");
    assert.equal((await calls()).length, 0);
    // A 10s idle timeout does not cut a 12s answer that streams a chunk every 3s.
    s = { ...s, timeoutSeconds: 10 };
    assert.equal((await put(s)).status, 200);
    const slow = await message("slow", { stream: true });
    assert.match(await slow.text(), /message_stop/);
    // Kiro answered (billed) but the tool JSON is broken: client must not resend.
    const broken = await message("broken-tool");
    assert.equal(broken.status, 502);
    assert.equal(broken.headers.get("x-should-retry"), "false");
    // Old tool output is replaced before it reaches Kiro once the prompt is large.
    s = { ...s, clearTriggerTokens: 1000, clearKeepToolUses: 1 };
    assert.equal((await put(s)).status, 200);
    const tools = [{ name: "Read", input_schema: { type: "object", properties: {} } }];
    const history = [{ role: "user", content: "read both" }];
    for (const id of ["a", "b"])
      history.push(
        { role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: id.repeat(6000) }] },
      );
    history.push({ role: "assistant", content: "Done reading." }, { role: "user", content: "now summarize" });
    const trimmed = await send("/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-haiku-4.5", max_tokens: 100, tools, messages: history }),
    });
    assert.equal(trimmed.status, 200);
    const sentHistory = JSON.stringify((await calls()).at(-1).conversationState.history);
    assert.match(sentHistory, /Tool result cleared by gateway/);
    assert.ok(!sentHistory.includes("a".repeat(6000)));
    assert.ok(sentHistory.includes("b".repeat(6000)), "most recent tool result kept");
    const rows = (await (await send("/api/requests?days=1")).json()).items;
    const clearedRow = rows.find((r) => r.optimizations === "cleared:1");
    assert.ok(clearedRow.saved_tokens > 1000);
    const local = rows.find((r) => r.optimizations.includes("local_reply"));
    assert.equal(local.estimated_credits, 0);
    assert.equal(rows.find((r) => r.error_code === "invalid_tool_arguments").status, 502);
  } finally {
    await mf.dispose();
  }
});

test("compaction: summarize once, reuse for later turns, log the summarizer call", async () => {
  const mf = gateway(recording);
  try {
    const { send, calls } = await signedIn(mf);
    const s = (await (await send("/api/settings")).json()).settings;
    const put = (next) => send("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    assert.equal(
      (await put({ ...s, clearToolResults: false, responseCacheSeconds: 0, compactEnabled: true, compactTriggerTokens: 10000, compactKeepTokens: 2000 })).status,
      200,
    );
    const history = [];
    for (let i = 0; i < 12; i++)
      history.push({ role: "user", content: `step ${i} ` + "z".repeat(4000) }, { role: "assistant", content: `ok ${i}` });
    const ask = (messages) =>
      send("/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-sonnet-4.5", max_tokens: 100, messages }) });
    const first = await ask([...history, { role: "user", content: "continue" }]);
    assert.equal(first.status, 200);
    let log = await calls();
    const summarizer = log.filter((p) => p.conversationState.currentMessage.userInputMessage.content.startsWith("You are compacting"));
    assert.equal(summarizer.length, 1);
    assert.equal(summarizer[0].conversationState.currentMessage.userInputMessage.modelId, "claude-haiku-4.5");
    const main = JSON.stringify(log.at(-1).conversationState);
    assert.match(main, /Summary of the earlier conversation/);
    assert.match(main, /Hello world/, "summary text from the summarizer");
    assert.ok(!main.includes("step 0 "), "summarized turns are not resent");
    // Next turn shares the start: stored summary reused, no new summarizer call.
    const second = await ask([...history, { role: "user", content: "continue" }, { role: "assistant", content: "done" }, { role: "user", content: "thanks" }]);
    assert.equal(second.status, 200);
    log = await calls();
    assert.equal(log.filter((p) => p.conversationState.currentMessage.userInputMessage.content.startsWith("You are compacting")).length, 1);
    assert.match(JSON.stringify(log.at(-1).conversationState), /Summary of the earlier conversation/);
    const rows = (await (await send("/api/requests?days=1")).json()).items;
    assert.equal(rows.filter((r) => r.endpoint === "internal:compact" && r.status === 200).length, 1);
    assert.ok(rows.some((r) => r.optimizations === "compact_new" && r.saved_tokens > 5000));
    assert.ok(rows.some((r) => r.optimizations === "compact"));
    // Turning compaction off deletes stored summaries: the next long request is sent whole.
    await put({ ...s, clearToolResults: false, responseCacheSeconds: 0, compactEnabled: false });
    await ask([...history, { role: "user", content: "again" }]);
    assert.match(JSON.stringify((await calls()).at(-1).conversationState), /step 0 /);
  } finally {
    await mf.dispose();
  }
});

test("response cache: identical resend replays, concurrent duplicates share one call", async () => {
  const mf = gateway(recording);
  try {
    const { send, calls } = await signedIn(mf);
    const ask = (content, stream = false) =>
      send("/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-sonnet-4.5", max_tokens: 100, stream, messages: [{ role: "user", content }] }) });
    const first = await (await ask("cache me")).json();
    const again = await ask("cache me", true);
    assert.equal(again.headers.get("x-gateway-cache"), "hit");
    const text = await again.text();
    assert.match(text, /Hello world/);
    assert.match(text, /message_stop/);
    assert.equal(first.content[0].text, "Hello world");
    assert.equal((await calls()).length, 1);
    // Two identical slow requests at once: Kiro is called once.
    const [a, b] = await Promise.all([ask("slow twin"), ask("slow twin")]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal((await calls()).filter((p) => p.conversationState.currentMessage.userInputMessage.content === "slow twin").length, 1);
    // A different request is not served from cache.
    await ask("something else");
    assert.equal((await calls()).length, 3);
    const rows = (await (await send("/api/requests?days=1")).json()).items;
    const hits = rows.filter((r) => r.optimizations === "cache_hit");
    assert.equal(hits.length, 2);
    assert.ok(hits.every((r) => r.estimated_credits === 0 && r.reported_credits === null));
  } finally {
    await mf.dispose();
  }
});

test("stats: clearing history mid-stream keeps the in-flight row and counts it once", async () => {
  const mf = gateway(recording);
  try {
    const { send } = await signedIn(mf);
    const s = (await (await send("/api/settings")).json()).settings;
    assert.equal((await send("/api/settings", { method: "PUT", body: JSON.stringify({ ...s, responseCacheSeconds: 0 }) })).status, 200);
    const ask = (content, stream = false) =>
      send("/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-sonnet-4.5", max_tokens: 100, stream, messages: [{ role: "user", content }] }) });
    assert.equal((await ask("warm up")).status, 200);
    const overview = async () => (await (await send("/api/overview?period=day&tz=0")).json());
    const before = await overview();
    assert.equal(before.totals.requests, 1);
    const slow = await ask("slow stream", true);
    assert.equal(slow.status, 200);
    assert.equal((await overview()).active, 1);
    assert.equal((await (await send("/api/requests", { method: "DELETE" })).json()).deleted, 1);
    assert.match(await slow.text(), /message_stop/);
    const rows = (await (await send("/api/requests?period=day&tz=0")).json()).items;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 200);
    const after = await overview();
    assert.equal(after.totals.requests, before.totals.requests + 1);
    assert.equal(after.active, 0);
  } finally {
    await mf.dispose();
  }
});

test("request detail: trace steps, source info, payload capture and search", async () => {
  const mf = gateway(upstream);
  try {
    const { send } = await signedIn(mf);
    let s = (await (await send("/api/settings")).json()).settings;
    const put = (next) => send("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    s = { ...s, responseCacheSeconds: 0, capturePayloads: "errors", models: [...s.models, "anthropic/claude-sonnet-5-5"] };
    assert.equal((await put(s)).status, 200);
    const chat = (text) =>
      send("/v1/chat/completions", {
        method: "POST",
        headers: { "User-Agent": "trace-test/1.0" },
        body: JSON.stringify({ model: "claude-sonnet-4.5", messages: [{ role: "user", content: text }] }),
      });
    const detail = async (id) => (await send("/api/requests/" + id)).json();
    const ok = await chat("hello");
    assert.equal(ok.status, 200);
    const okDetail = await detail(ok.headers.get("x-request-id"));
    const keys = okDetail.steps.map((step) => step.key);
    for (const key of ["received", "auth", "optimize", "upstream", "done"]) assert.ok(keys.includes(key), key);
    assert.equal(okDetail.steps.find((step) => step.key === "upstream").detail, "q.us-east-1.amazonaws.com");
    assert.equal(okDetail.steps.find((step) => step.key === "optimize").state, "skip");
    assert.equal(okDetail.request.user_agent, "trace-test/1.0");
    assert.equal(okDetail.request.upstream_host, "q.us-east-1.amazonaws.com");
    assert.equal(typeof okDetail.request.ttfb, "number");
    assert.equal(okDetail.request.steps, undefined, "steps are returned once, parsed");
    assert.equal(okDetail.payload, null, "errors mode keeps successful payloads out");
    // Errors mode: the failed request's payload is stored.
    const limited = await chat("rate-limit");
    assert.equal(limited.status, 429);
    const bad = await detail(limited.headers.get("x-request-id"));
    assert.match(bad.payload.request, /rate-limit/);
    assert.match(bad.payload.response, /"error"/);
    assert.equal(bad.payload.truncated, false);
    assert.equal(bad.steps.at(-1).key, "error");
    assert.equal(bad.steps.at(-1).detail, bad.request.error_code);
    assert.ok(bad.request.error_message);
    // Unknown or malformed id.
    assert.equal((await send("/api/requests/msg_00000000-0000-0000-0000-000000000000")).status, 404);
    assert.equal((await send("/api/requests/nope")).status, 404);
    // All mode: the native Anthropic SSE relay is captured as relayed.
    assert.equal((await put({ ...s, capturePayloads: "all" })).status, 200);
    const native = await send("/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "gateway-test-key", "anthropic-version": "2023-06-01", "anthropic-beta": "claude-code-20250219" },
      body: JSON.stringify({ model: "anthropic/claude-sonnet-5-5", stream: true, max_tokens: 100, messages: [{ role: "user", content: "hi" }] }),
    });
    const nativeText = await native.text();
    const nativeDetail = await detail(native.headers.get("x-request-id"));
    assert.equal(nativeDetail.payload.response, nativeText);
    assert.equal(nativeDetail.steps.find((step) => step.key === "optimize").detail, "not_kiro");
    assert.equal(nativeDetail.steps.find((step) => step.key === "stream").state, "done");
    // Search: case-insensitive, wildcards are literal.
    const search = async (q) => (await (await send("/api/requests?q=" + encodeURIComponent(q))).json()).total;
    assert.equal(await search("KIRO_HTTP_429"), 1);
    assert.equal(await search("%"), 0);
    assert.equal(await search("kir__http"), 0, "_ is not a wildcard");
    // Turning capture off deletes stored payloads.
    assert.equal((await put({ ...s, capturePayloads: "off" })).status, 200);
    assert.equal((await detail(native.headers.get("x-request-id"))).payload, null);
    assert.equal((await detail(limited.headers.get("x-request-id"))).payload, null);
  } finally {
    await mf.dispose();
  }
});

test("payload capture: turning it off mid-stream leaves no payload behind", async () => {
  const mf = gateway(recording);
  try {
    const { send } = await signedIn(mf);
    const s = (await (await send("/api/settings")).json()).settings;
    const put = (next) => send("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    assert.equal((await put({ ...s, responseCacheSeconds: 0, capturePayloads: "all" })).status, 200);
    const slow = await send("/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-sonnet-4.5", max_tokens: 100, stream: true, messages: [{ role: "user", content: "slow private" }] }),
    });
    assert.equal(slow.status, 200);
    assert.equal((await put({ ...s, responseCacheSeconds: 0, capturePayloads: "off" })).status, 200);
    assert.match(await slow.text(), /message_stop/);
    const detail = await (await send("/api/requests/" + slow.headers.get("x-request-id"))).json();
    assert.equal(detail.request.status, 200);
    assert.equal(detail.payload, null);
  } finally {
    await mf.dispose();
  }
});

test("provider quotas: Kiro credits, OpenRouter balance, cost, and failures stay per entry", async () => {
  const mf = gateway(upstream);
  try {
    const { send } = await signedIn(mf);
    const res = await send("/api/providers");
    assert.equal(res.status, 200);
    const { providers } = await res.json();
    assert.deepEqual(providers.map((p) => p.id), ["kiro", "anthropic", "openrouter", "deploy"]);
    const by = Object.fromEntries(providers.map((p) => [p.id, p]));
    assert.equal(by.kiro.ok, true);
    assert.equal(by.kiro.used, 235.4);
    assert.equal(by.kiro.limit, 2000);
    assert.equal(by.kiro.plan, "KIRO PRO");
    assert.ok(Math.abs(by.openrouter.balanceUsd - 18.6) < 1e-9);
    assert.equal(by.anthropic.unit, "usd");
    assert.equal(typeof by.anthropic.monthCostUsd, "number");
    assert.equal(by.deploy.ok, true);
  } finally {
    await mf.dispose();
  }
  const failing = `export default {async fetch(request){const u=new URL(request.url);if(u.pathname==='/getUsageLimits')return new Response('secret body',{status:500});if(u.hostname==='openrouter.ai')return Response.json({oops:1});return Response.json({});}};`;
  const mf2 = gateway(failing);
  try {
    const { send } = await signedIn(mf2);
    const res = await send("/api/providers");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes("secret body"));
    const by = Object.fromEntries(JSON.parse(text).providers.map((p) => [p.id, p]));
    assert.equal(by.kiro.ok, false);
    assert.equal(by.kiro.error, "http_500");
    assert.equal(by.openrouter.error, "bad_response");
  } finally {
    await mf2.dispose();
  }
});

test("provider quotas: healthy answers are cached, failures and sign-in changes are not", async () => {
  const counting = `let n=0;export default {async fetch(request){const u=new URL(request.url);if(u.pathname==='/count')return Response.json({n});if(u.pathname==='/ListAvailableProfiles')return Response.json({profiles:[{arn:'arn:x'}]});if(u.pathname==='/getUsageLimits'){n++;return n===1?new Response('x',{status:503}):Response.json({usageBreakdownList:[{resourceType:'CREDIT',currentUsage:1,usageLimit:2}]});}if(u.hostname==='openrouter.ai')return Response.json({data:{total_credits:2,total_usage:1}});return Response.json({});}};`;
  const mf = gateway(counting);
  try {
    const { send } = await signedIn(mf);
    const count = async () => (await (await (await mf.getWorker("upstream")).fetch("https://q.us-east-1.amazonaws.com/count")).json()).n;
    const kiro = async (q = "") => (await (await send("/api/providers" + q)).json()).providers[0];
    assert.equal((await kiro()).error, "http_503");
    assert.equal((await kiro()).ok, true);
    assert.equal(await count(), 2);
    assert.equal((await kiro()).ok, true);
    assert.equal(await count(), 2, "healthy answer served from cache");
    await kiro("?refresh=1");
    assert.equal(await count(), 3);
  } finally {
    await mf.dispose();
  }
});

test("running request: live output in the detail view, stop from the dashboard", async () => {
  const mf = gateway(recording);
  try {
    const { send } = await signedIn(mf);
    const s = (await (await send("/api/settings")).json()).settings;
    assert.equal((await send("/api/settings", { method: "PUT", body: JSON.stringify({ ...s, responseCacheSeconds: 0 }) })).status, 200);
    const slow = await send("/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-sonnet-4.5", max_tokens: 100, stream: true, messages: [{ role: "user", content: "slow live" }] }),
    });
    assert.equal(slow.status, 200);
    const id = slow.headers.get("x-request-id");
    // The first "." arrives right away; the next ones every 3 s.
    const reader = slow.body.getReader();
    await reader.read();
    let detail;
    for (let i = 0; i < 20; i++) {
      detail = await (await send(`/api/requests/${id}?since=0`)).json();
      if (detail.live?.text) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(detail.request.status, 0);
    assert.equal(detail.live.text, ".");
    assert.equal(detail.live.from, 0);
    assert.ok(detail.live.bytes > 0);
    // Only what is new since the viewer's last read.
    assert.equal((await (await send(`/api/requests/${id}?since=1`)).json()).live.text, "");
    assert.equal((await send(`/api/requests/${id}/cancel`, { method: "POST", headers: { Origin: "https://evil.test" } })).status, 403);
    assert.equal((await send(`/api/requests/${id}/cancel`, { method: "POST" })).status, 200);
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    assert.match(rest, /cancelled/);
    const after = await (await send(`/api/requests/${id}`)).json();
    assert.equal(after.request.status, 499);
    assert.equal(after.request.error_code, "cancelled");
    assert.equal(after.live, null);
    assert.equal((await send(`/api/requests/${id}/cancel`, { method: "POST" })).status, 409);
    // The agent that sent a request is shown in the history (and searchable).
    const tagged = await send("/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-sonnet-4.5", max_tokens: 100, system: "You implement tasks. [agent:coder]", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(tagged.status, 200);
    const found = (await (await send("/api/requests?q=coder")).json()).items;
    assert.equal(found.length, 1);
    assert.equal(found[0].agent, "coder");
  } finally {
    await mf.dispose();
  }
});
