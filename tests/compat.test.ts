import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CompatStream,
  CompatUsage,
  fromUpstreamJson,
  routeModel,
  toUpstream,
} from "../src/compat.ts";
import { defaults } from "../src/types.ts";

const settings = {
  ...defaults,
  models: [
    "claude-sonnet-4.5",
    "openrouter/deepseek/deepseek-chat-v3.1",
    "deploy/deepseek-ai/deepseek-v4.1-flash-1017",
  ],
};
const sse = (...chunks: unknown[]) =>
  chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("");

test("routes prefixed models to providers and leaves Kiro models alone", () => {
  assert.equal(routeModel("claude-sonnet-4.5", settings), null);
  const or = routeModel("openrouter/deepseek/deepseek-chat-v3.1", settings)!;
  assert.equal(or.provider.id, "openrouter");
  assert.equal(or.upstreamModel, "deepseek/deepseek-chat-v3.1");
  const dp = routeModel("deploy/deepseek-ai/deepseek-v4.1-flash-1017", settings)!;
  assert.equal(dp.provider.id, "deploy");
  assert.equal(dp.upstreamModel, "deepseek-ai/deepseek-v4.1-flash-1017");
  assert.throws(() => routeModel("openrouter/not-allowed", settings), /not enabled/);
});

test("converts a Claude Code style Anthropic request to OpenAI chat completions", () => {
  const route = routeModel("openrouter/deepseek/deepseek-chat-v3.1", settings)!;
  const { payload, stream } = toUpstream(
    {
      model: route.publicModel,
      stream: true,
      max_tokens: 32000,
      temperature: 1,
      thinking: { type: "enabled", budget_tokens: 4000 },
      metadata: { user_id: "x" },
      system: [{ type: "text", text: "You are helpful.", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "Bash", description: "Run", input_schema: { type: "object", properties: { command: { type: "string" } } } }],
      tool_choice: { type: "any" },
      messages: [
        // Captured from Claude Code 2.1.325: system-role entries inside messages.
        { role: "system", content: [{ type: "text", text: "Extra context." }] },
        { role: "user", content: [{ type: "text", text: "list" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm", signature: "s" },
            { type: "text", text: "Running." },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "README.md" }] }, { type: "text", text: "next" }] },
      ],
    },
    "anthropic",
    route,
  );
  assert.equal(stream, true);
  assert.equal(payload.model, "deepseek/deepseek-chat-v3.1");
  assert.deepEqual(payload.stream_options, { include_usage: true });
  assert.deepEqual(payload.usage, { include: true });
  assert.deepEqual(payload.reasoning, { max_tokens: 4000 });
  assert.equal(payload.tool_choice, "required");
  assert.equal(payload.max_tokens, 32000);
  assert.equal(payload.tools[0].function.name, "Bash");
  assert.deepEqual(
    payload.messages.map((m: any) => m.role),
    ["system", "system", "user", "assistant", "tool", "user"],
  );
  assert.equal(payload.messages[2].content[1].image_url.url, "data:image/png;base64,AAAA");
  assert.equal(payload.messages[1].content, "Extra context.");
  assert.equal(payload.messages[3].content, "Running.");
  assert.equal(payload.messages[3].tool_calls[0].function.arguments, '{"command":"ls"}');
  assert.equal(payload.messages[4].tool_call_id, "toolu_1");
  assert.equal(payload.messages[4].content, "README.md");
});

test("OpenAI clients are forwarded with only the model swapped", () => {
  const route = routeModel("deploy/deepseek-ai/deepseek-v4.1-flash-1017", settings)!;
  const { payload, includeUsage } = toUpstream(
    { model: route.publicModel, messages: [{ role: "user", content: "hi" }], temperature: 0.2, reasoning_effort: "low" },
    "openai",
    route,
  );
  assert.equal(payload.model, "deepseek-ai/deepseek-v4.1-flash-1017");
  assert.equal(payload.temperature, 0.2);
  assert.equal(payload.reasoning_effort, "low");
  assert.equal(includeUsage, false);
});

test("streams text live and emits tool blocks whole for Anthropic clients", () => {
  const usage = new CompatUsage(10);
  const s = new CompatStream("anthropic", "msg_1", "openrouter/x", usage, false);
  let out = s.start();
  out += s.feed(": OPENROUTER PROCESSING\n\n");
  out += s.feed(sse({ choices: [{ delta: { content: "Hel" } }] }).slice(0, 20));
  out += s.feed(sse({ choices: [{ delta: { content: "Hel" } }] }).slice(20));
  out += s.feed(sse({ choices: [{ delta: { content: "lo" } }] }));
  out += s.feed(sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: '{"comm' } }] } }] }));
  out += s.feed(sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] }, finish_reason: "tool_calls" }] }));
  out += s.feed(sse({ choices: [], usage: { prompt_tokens: 42, completion_tokens: 7, cost: 0.0012 } }, "[DONE]"));
  out += s.end();
  const events = out
    .split("\n\n")
    .filter(Boolean)
    .map((e) => JSON.parse(e.split("\n")[1].slice(6)));
  assert.deepEqual(
    events.map((e) => e.type),
    ["message_start", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"],
  );
  assert.equal(events[2].delta.text + events[3].delta.text, "Hello");
  assert.equal(events[5].content_block.name, "Bash");
  assert.deepEqual(JSON.parse(events[6].delta.partial_json), { command: "ls" });
  assert.equal(events[8].delta.stop_reason, "tool_use");
  assert.equal(usage.inputTokens, 42);
  assert.equal(usage.outputTokens, 7);
  assert.equal(usage.costUsd, 0.0012);
});

test("OpenAI stream passthrough hides the usage chunk unless asked, and requires a finish", () => {
  const usage = new CompatUsage(0);
  const s = new CompatStream("openai", "c1", "deploy/m", usage, false);
  const out =
    s.feed(sse({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }], model: "m" })) +
    s.feed(sse({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } })) +
    s.end();
  assert.match(out, /"model":"deploy\/m"/);
  assert.ok(!out.includes("prompt_tokens"));
  assert.match(out, /\[DONE\]/);
  assert.equal(usage.outputTokens, 1);
  const cut = new CompatStream("openai", "c2", "deploy/m", new CompatUsage(0), false);
  cut.feed(sse({ choices: [{ delta: { content: "par" } }] }));
  assert.throws(() => cut.end(), /before finishing/);
});

test("non-streaming JSON converts to an Anthropic message with tool use", () => {
  const usage = new CompatUsage(0);
  const body = fromUpstreamJson(
    {
      choices: [{ finish_reason: "tool_calls", message: { content: "ok", tool_calls: [{ id: "c", function: { name: "Bash", arguments: '{"command":"pwd"}' } }] } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    },
    "anthropic",
    "msg_2",
    "openrouter/x",
    usage,
  );
  assert.equal(body.stop_reason, "tool_use");
  assert.deepEqual(body.content[1], { type: "tool_use", id: "c", name: "Bash", input: { command: "pwd" } });
  assert.deepEqual(body.usage, { input_tokens: 5, output_tokens: 2 });
  assert.throws(
    () => fromUpstreamJson({ error: { message: "No endpoints found" } }, "openai", "x", "m", new CompatUsage(0)),
    /No endpoints found/,
  );
});
