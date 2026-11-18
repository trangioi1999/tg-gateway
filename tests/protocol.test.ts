import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepare,
  Completion,
  EventDecoder,
  crc32,
  credits,
  estimateTokens,
} from "../src/protocol.ts";
import { defaults, validateSettings } from "../src/types.ts";
import { Formatter, consume } from "../src/stream.ts";

function frame(type: string, data: unknown, messageType = "event") {
  const enc = new TextEncoder();
  const headers = [];
  for (const [name, value] of Object.entries({
    ":message-type": messageType,
    ":event-type": type,
    ":content-type": "application/json",
  })) {
    const n = enc.encode(name),
      v = enc.encode(value);
    headers.push(
      n.length,
      ...n,
      7,
      (v.length >>> 8) & 255,
      v.length & 255,
      ...v,
    );
  }
  const payload = enc.encode(JSON.stringify(data)),
    length = 16 + headers.length + payload.length,
    bytes = new Uint8Array(length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, length);
  view.setUint32(4, headers.length);
  view.setUint32(8, crc32(bytes.slice(0, 8)));
  bytes.set(headers, 12);
  bytes.set(payload, 12 + headers.length);
  view.setUint32(length - 4, crc32(bytes.slice(0, length - 4)));
  return bytes;
}
const request = {
  model: "claude-sonnet-4-5",
  messages: [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Xin chào" },
  ],
};
test("normalizes model, preserves system and current message", () => {
  const p = prepare(request, "openai", defaults);
  assert.equal(p.model, "claude-sonnet-4.5");
  assert.equal(
    p.payload.conversationState.currentMessage.userInputMessage.content,
    "Be concise.\n\nXin chào",
  );
  assert.ok(p.estimatedInput > 0);
});
test("tool results remain paired with assistant tool calls", () => {
  const p = prepare(
    {
      model: request.model,
      tools: [
        {
          type: "function",
          function: { name: "weather", parameters: { type: "object" } },
        },
      ],
      messages: [
        { role: "user", content: "Weather?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "t1",
              function: { name: "weather", arguments: '{"city":"Hanoi"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "t1", content: "Sunny" },
      ],
    },
    "openai",
    defaults,
  );
  const state = p.payload.conversationState;
  assert.equal(
    state.history[1].assistantResponseMessage.toolUses[0].input.city,
    "Hanoi",
  );
  assert.equal(
    state.currentMessage.userInputMessage.userInputMessageContext.toolResults[0]
      .toolUseId,
    "t1",
  );
});
test("validates dangling tools, unsupported inputs and models", () => {
  // A result without its call is kept as text instead of failing the request.
  const orphan = prepare(
    { ...request, messages: [{ role: "tool", tool_call_id: "missing", content: "x" }] },
    "openai",
    defaults,
  ).payload.conversationState.currentMessage.userInputMessage;
  assert.equal(orphan.content, "[Result of tool call missing: x]");
  assert.equal(orphan.userInputMessageContext, undefined);
  assert.throws(() =>
    prepare({ ...request, model: "not-enabled" }, "openai", defaults),
  );
  assert.deepEqual(
    prepare(
      { ...request, temperature: 0.5, thinking: { type: "disabled" } },
      "openai",
      defaults,
    ).ignored,
    ["thinking", "temperature"],
  );
  assert.deepEqual(prepare({ ...request, stop: "END" }, "openai", defaults).stopSequences, ["END"]);
  assert.deepEqual(prepare({ ...request, stop_sequences: ["</a>", "</a>"] }, "anthropic", defaults).stopSequences, ["</a>"]);
  assert.throws(
    () => prepare({ ...request, stop_sequences: [""] }, "anthropic", defaults),
    /Stop sequences/,
  );
  assert.throws(() =>
    prepare(
      {
        ...request,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "https://example.com" } },
            ],
          },
        ],
      },
      "openai",
      defaults,
    ),
  );
});
test("Anthropic history, tool blocks and system translate", () => {
  const p = prepare(
    {
      model: request.model,
      system: [{ type: "text", text: "Helpful" }],
      tools: [{ name: "read", input_schema: { type: "object" } }],
      messages: [
        { role: "user", content: "Read" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "a", name: "read", input: { path: "a" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "a", content: "Done" }],
        },
      ],
    },
    "anthropic",
    defaults,
  );
  assert.match(
    p.payload.conversationState.history[0].userInputMessage.content,
    /Helpful/,
  );
});
test("AWS binary decoder handles every one-byte chunk boundary including UTF-8", () => {
  const bytes = frame("assistantResponseEvent", { content: "Xin chào 🌏" }),
    decoder = new EventDecoder();
  const events = [];
  for (const byte of bytes) events.push(...decoder.feed(Uint8Array.of(byte)));
  decoder.finish();
  assert.equal(events.length, 1);
  assert.equal(events[0].data.content, "Xin chào 🌏");
});
test("decoder rejects corrupt and truncated frames", () => {
  const bytes = frame("assistantResponseEvent", { content: "hello" });
  bytes[bytes.length - 5] ^= 1;
  assert.throws(() => new EventDecoder().feed(bytes), /checksum/);
  const d = new EventDecoder();
  d.feed(frame("a", {}).slice(0, -1));
  assert.throws(() => d.finish(), /inside a frame/);
});
test("repeated text is retained; zero reported credits is distinct from unknown", () => {
  const c = new Completion(25);
  assert.equal(c.reportedCredits, null);
  for (let i = 0; i < 2; i++)
    c.accept({
      headers: { ":event-type": "assistantResponseEvent" },
      data: { content: "ha" },
    });
  c.accept({ headers: { ":event-type": "meteringEvent" }, data: { usage: 0 } });
  c.validateEnd();
  assert.equal(c.text, "haha");
  assert.equal(c.reportedCredits, 0);
  assert.equal(c.outputSource, "estimated");
});
test("reported token counts override estimates; context percentage is not a token count", () => {
  const c = new Completion(20);
  c.accept({
    headers: { ":event-type": "metadataEvent" },
    data: { inputTokens: 123, outputTokens: 45 },
  });
  c.accept({
    headers: { ":event-type": "contextUsageEvent" },
    data: { contextUsagePercentage: 10 },
  });
  c.validateEnd();
  assert.deepEqual(c.usage(), {
    prompt_tokens: 123,
    completion_tokens: 45,
    total_tokens: 168,
  });
  assert.equal(c.inputSource, "reported");
});
test("stream errors and unfinished tool JSON never report success", () => {
  const c = new Completion(0);
  assert.throws(() =>
    c.accept({ headers: { ":message-type": "exception" }, data: {} }),
  );
  c.accept({
    headers: { ":event-type": "toolUseEvent" },
    data: { name: "read", toolUseId: "a", input: '{"path":' },
  });
  assert.throws(
    () =>
      c.accept({
        headers: { ":event-type": "toolUseEvent" },
        data: { stop: true },
      }),
    /incomplete tool/,
  );
  const quiet = new Completion(0);
  quiet.validateEnd();
  assert.equal(quiet.terminal, false);
});
test("consume + both response formats preserve tool results and metering", async () => {
  const frames = [
    frame("assistantResponseEvent", { content: "Hello" }),
    frame("toolUseEvent", {
      name: "read",
      toolUseId: "a",
      input: '{"path":"a"}',
      stop: true,
    }),
    frame("meteringEvent", { usage: 0.02 }),
  ];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        frames.forEach((f) => controller.enqueue(f));
        controller.close();
      },
    }),
  );
  const c = new Completion(20);
  await consume(response, prepare(request, "openai", defaults), c);
  assert.equal(c.reportedCredits, 0.02);
  const openai = new Formatter("openai", "id", "model"),
    anthropic = new Formatter("anthropic", "id", "model");
  assert.match(JSON.stringify(openai.json(c)), /tool_calls/);
  assert.match(JSON.stringify(anthropic.json(c)), /tool_use/);
  assert.match(openai.finish(c, true), /\[DONE\]/);
  assert.match(anthropic.finish(c, false), /message_stop/);
});
test("credit conversion and settings validation", () => {
  assert.equal(
    credits(1e6, 2e6, {
      inputCreditsPerMillion: 2,
      outputCreditsPerMillion: 3,
    }),
    8,
  );
  assert.ok(estimateTokens("Việt Nam") >= 3);
  assert.throws(() =>
    validateSettings({ ...defaults, inputCreditsPerMillion: NaN }),
  );
  assert.throws(() => validateSettings({ ...defaults, retentionDays: 0 }));
  assert.throws(() =>
    validateSettings({ ...defaults, apiRegion: "evil.com/" }),
  );
  assert.deepEqual(validateSettings(defaults), defaults);
});

test("anthropic text blocks are joined with a newline", () => {
  const prepared = prepare(
    {
      model: "claude-sonnet-4.5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: "World", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
    },
    "anthropic",
    defaults,
  );
  assert.equal(
    prepared.payload.conversationState.currentMessage.userInputMessage.content,
    "Hello\nWorld",
  );
});
test("accepts Claude Code sized tool lists and moves long descriptions to the system prompt", () => {
  const tools = Array.from({ length: 150 }, (_, i) => ({
    name: `mcp__srv__tool_${i}`,
    description: i === 0 ? "x".repeat(12_000) : "short",
    input_schema: { type: "object", properties: {} },
  }));
  const p = prepare(
    { model: defaults.models[0], system: "Base.", tools, messages: [{ role: "user", content: "hi" }] },
    "anthropic",
    defaults,
  );
  const ctx = (p.payload as any).conversationState.currentMessage.userInputMessage;
  const specs = ctx.userInputMessageContext.tools;
  assert.equal(specs.length, 150);
  assert.match(specs[0].toolSpecification.description, /Full documentation/);
  assert.match(ctx.content, /^Base\.\n\n# Tool documentation\n\n## Tool: mcp__srv__tool_0\n\nxxx/);
  assert.throws(
    () => prepare({ model: defaults.models[0], tools: [...tools, ...tools.map((t) => ({ ...t, name: t.name + "b" }))], messages: [{ role: "user", content: "hi" }] }, "anthropic", defaults),
    /At most 256 tools/,
  );
});

test("max_tokens is exposed and a max_tokens stop is reported in both dialects", async () => {
  const p = prepare(
    { model: defaults.models[0], max_tokens: 1, messages: [{ role: "user", content: "quota" }] },
    "anthropic",
    defaults,
  );
  assert.equal(p.maxTokens, 1);
  const c = new Completion(5);
  c.stopReason = "max_tokens";
  assert.equal((new Formatter("anthropic", "id", "m").json(c) as any).stop_reason, "max_tokens");
  assert.match(new Formatter("anthropic", "id", "m").finish(c, false), /"stop_reason":"max_tokens"/);
  assert.equal((new Formatter("openai", "id", "m").json(c) as any).choices[0].finish_reason, "length");
});

test("consume reports every upstream chunk (idle timeout heartbeat)", async () => {
  const frames = [
    frame("assistantResponseEvent", { content: "a" }),
    frame("assistantResponseEvent", { content: "b" }),
    frame("meteringEvent", { usage: 0.01 }),
  ];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        frames.forEach((f) => controller.enqueue(f));
        controller.close();
      },
    }),
  );
  let chunks = 0;
  await consume(response, prepare(request, "openai", defaults), new Completion(1), undefined, () => chunks++);
  assert.equal(chunks, 3);
});

import { kiroToolName } from "../src/protocol.ts";

test("tool names Kiro rejects are renamed, deduplicated and mapped back", async () => {
  const long = "mcp__plugin_marketplace_very_long_server_name__search_documents_by_query_text";
  const dotted = "server.tool:v2";
  assert.ok(long.length > 64);
  const schema = { type: "object", properties: {} };
  const p = prepare(
    {
      model: defaults.models[0],
      tools: [
        { name: "Bash", input_schema: schema },
        { name: long, input_schema: schema },
        { name: dotted, input_schema: schema },
        { name: "Bash", description: "duplicate", input_schema: schema },
      ],
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: long, input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      ],
    },
    "anthropic",
    defaults,
  );
  const sent = (p.payload as any).conversationState;
  const specs = sent.currentMessage.userInputMessage.userInputMessageContext.tools.map(
    (t: any) => t.toolSpecification.name,
  );
  assert.equal(specs.length, 3, "duplicate Bash dropped");
  assert.ok(specs.every((n: string) => /^[\w-]{1,64}$/.test(n)));
  assert.equal(specs[0], "Bash");
  assert.equal(specs[1], kiroToolName(long));
  assert.equal(kiroToolName(long), kiroToolName(long), "stable across turns");
  assert.notEqual(kiroToolName(dotted), kiroToolName("server_tool_v2"), "no collision with a legal look-alike");
  assert.equal(sent.history[1].assistantResponseMessage.toolUses[0].name, specs[1]);
  assert.equal(p.toolNames.get(specs[1]), long);
  assert.equal(p.toolNames.has("Bash"), false);
  // Kiro calls the renamed tool: the client sees its own name.
  const c = new Completion(1);
  c.toolNames = p.toolNames;
  const { tool } = c.accept({
    headers: { ":event-type": "toolUseEvent", ":message-type": "event" },
    data: { name: specs[2], toolUseId: "x", input: "{}", stop: true },
  });
  assert.equal(tool?.name, dotted);
  assert.throws(
    () => prepare({ model: defaults.models[0], tools: [{ name: "", input_schema: schema }], messages: [{ role: "user", content: "hi" }] }, "anthropic", defaults),
    /1–256 characters/,
  );
});

test("unpairable tool calls become text instead of a 400 (Claude Code compaction, MCP churn)", () => {
  const schema = { type: "object", properties: {} };
  const history = [
    { role: "user", content: "start" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm", signature: "sig" },
        { type: "text", text: "Checking." },
        { type: "tool_use", id: "a", name: "Read", input: { path: "x" } },
        { type: "tool_use", id: "b", name: "mcp__gone__tool", input: { q: 1 } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "file body" },
        { type: "tool_result", tool_use_id: "b", content: "gone result" },
      ],
    },
    { role: "assistant", content: [{ type: "tool_use", id: "c", name: "Read", input: {} }] },
    // Interrupted: no result for c, user just types.
    { role: "user", content: "stop, summarize" },
  ];
  // Normal turn: Read declared, the MCP tool no longer is.
  const p = prepare(
    { model: defaults.models[0], tools: [{ name: "Read", input_schema: schema }], messages: history },
    "anthropic",
    defaults,
  );
  const state = (p.payload as any).conversationState;
  const first = state.history[1].assistantResponseMessage;
  assert.deepEqual(first.toolUses.map((u: any) => u.toolUseId), ["a"]);
  assert.match(first.content, /^Checking\.\n\[Called tool mcp__gone__tool \(b\) with \{"q":1\}\]$/);
  assert.ok(!first.content.includes("hmm"), "thinking dropped");
  const results = state.history[2].userInputMessage;
  assert.deepEqual(results.userInputMessageContext.toolResults.map((r: any) => r.toolUseId), ["a"]);
  assert.match(results.content, /^\[Result of tool call b: gone result\]/);
  assert.equal(state.history[3].assistantResponseMessage.toolUses, undefined);
  assert.match(state.history[3].assistantResponseMessage.content, /Called tool Read \(c\)/);
  // Compaction request: same history, no tools at all.
  const compact = prepare({ model: defaults.models[0], messages: history }, "anthropic", defaults);
  const text = JSON.stringify((compact.payload as any).conversationState);
  assert.ok(!text.includes('"toolUses"') && !text.includes('"toolResults"'));
  assert.match(text, /Result of tool call a: file body/);
  // Duplicate IDs: the second call becomes text.
  const dup = prepare(
    {
      model: defaults.models[0],
      tools: [{ name: "Read", input_schema: schema }],
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "tool_use", id: "d", name: "Read", input: {} }, { type: "tool_use", id: "d", name: "Read", input: { again: true } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "d", content: "one" }, { type: "tool_result", tool_use_id: "d", content: "two" }] },
      ],
    },
    "anthropic",
    defaults,
  );
  const ds = (dup.payload as any).conversationState;
  assert.equal(ds.history[1].assistantResponseMessage.toolUses.length, 1);
  assert.equal(ds.currentMessage.userInputMessage.userInputMessageContext.toolResults.length, 1);
  assert.match(ds.currentMessage.userInputMessage.content, /Result of tool call d: two/);
});

test("non-text blocks inside a tool result become a note", () => {
  const p = prepare(
    {
      model: defaults.models[0],
      tools: [{ name: "Read", input_schema: { type: "object", properties: {} } }],
      messages: [
        { role: "user", content: "look" },
        { role: "assistant", content: [{ type: "tool_use", id: "i", name: "Read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "i", content: [{ type: "text", text: "png:" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] },
      ],
    },
    "anthropic",
    defaults,
  );
  const r = (p.payload as any).conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults[0];
  assert.equal(r.content[0].text, "png:\n[image omitted: the Kiro route accepts text only]");
});

test("stop sequences: the gateway cuts Kiro's text at the first match, across chunks", async () => {
  const text = (content: string) => frame("assistantResponseEvent", { content });
  const frames = [text("<block>no"), text("</bl"), text("ock> and more"), frame("meteringEvent", { usage: 0.01 })];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        frames.forEach((f) => controller.enqueue(f));
        controller.close();
      },
    }),
  );
  const c = new Completion(10);
  c.stopSequences = ["</block>", "STOP"];
  const sent: string[] = [];
  await consume(response, undefined, c, async (d) => {
    if (d.text) sent.push(d.text);
  });
  assert.equal(c.text, "<block>no");
  assert.equal(sent.join(""), "<block>no", "nothing past the stop sequence reaches the client");
  assert.equal(c.stopReason, "stop_sequence");
  assert.equal(c.stopSequence, "</block>");
  assert.equal(c.reportedCredits, 0.01, "metering after the cut is still read");
  const anthropic = new Formatter("anthropic", "msg_1", "m").json(c) as Record<string, any>;
  assert.equal(anthropic.stop_reason, "stop_sequence");
  assert.equal(anthropic.stop_sequence, "</block>");
  assert.equal((new Formatter("openai", "c", "m").json(c) as Record<string, any>).choices[0].finish_reason, "stop");
  // No match: held-back text is flushed at the end.
  const plain = new Completion(0);
  plain.stopSequences = ["</block>"];
  const out: string[] = [];
  await consume(
    new Response(new ReadableStream({ start(ctl) { ctl.enqueue(text("ends with </bl")); ctl.close(); } })),
    undefined,
    plain,
    async (d) => { if (d.text) out.push(d.text); },
  );
  assert.equal(out.join(""), "ends with </bl");
  assert.equal(plain.stopReason, undefined);
});
