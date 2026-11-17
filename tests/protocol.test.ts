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
  assert.throws(() =>
    prepare(
      {
        ...request,
        messages: [{ role: "tool", tool_call_id: "missing", content: "x" }],
      },
      "openai",
      defaults,
    ),
  );
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
  assert.throws(
    () => prepare({ ...request, stop: ["END"] }, "openai", defaults),
    /stop is not supported/,
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
