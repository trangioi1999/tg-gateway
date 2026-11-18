import test from "node:test";
import assert from "node:assert/strict";
import { assemble, LiveOutput } from "../src/stream-text.ts";
import { formatJson, indentJson } from "../web/src/lib/highlight.ts";

const sse = (events: object[]) =>
  events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const anthropic = sse([
  { type: "message_start", message: { model: "claude-sonnet-4.5", usage: { input_tokens: 10 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":' } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"ls"}' } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
  { type: "message_stop" },
]);

test("assemble: Anthropic SSE becomes the final message", () => {
  assert.deepEqual(assemble(anthropic), {
    model: "claude-sonnet-4.5",
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Hello world" },
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
    ],
    usage: { input_tokens: 10, output_tokens: 7 },
  });
});

test("assemble: OpenAI SSE, JSON bodies, errors and unknown text", () => {
  const openai =
    [
      { model: "m", choices: [{ delta: { content: "Hi" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "Read", arguments: '{"p":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] }, finish_reason: "tool_calls" }] },
    ]
      .map((c) => "data: " + JSON.stringify(c) + "\n\n")
      .join("") + "data: [DONE]\n\n";
  assert.deepEqual(assemble(openai)?.content, [
    { type: "text", text: "Hi" },
    { type: "tool_use", id: "c1", name: "Read", input: { p: 1 } },
  ]);
  assert.equal(assemble(openai)?.stop_reason, "tool_calls");
  const body = JSON.stringify({ type: "message", model: "x", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] });
  assert.deepEqual(assemble(body)?.content, [{ type: "text", text: "ok" }]);
  assert.equal(assemble('event: error\ndata: {"type":"error","error":{"type":"cancelled","message":"stop"}}\n')?.error.type, "cancelled");
  assert.equal(assemble("not a stream"), null);
});

test("LiveOutput: readable text across chunk boundaries, incremental reads, bounded memory", () => {
  const live = new LiveOutput(16);
  // Split mid-line: the reader must buffer the partial event.
  live.append(anthropic.slice(0, 300));
  live.append(anthropic.slice(300));
  const all = live.since(0);
  assert.equal(all.total, live.total);
  assert.ok(live.total > 16);
  assert.equal(all.text.length, 16, "only the last `limit` characters are kept");
  assert.equal(all.from, live.total - 16);
  assert.match(all.text, /ls"\}\)\n$/);
  assert.deepEqual(live.since(live.total), { from: live.total, text: "", total: live.total });
  const big = new LiveOutput();
  big.append(anthropic);
  assert.equal(big.since(0).text, 'Hello world\n▶ Bash({"command":"ls"})\n');
  assert.equal(big.since(6).text, 'world\n▶ Bash({"command":"ls"})\n');
});

test("formatJson: pretty when valid, indented when cut at the capture limit", () => {
  assert.equal(formatJson('{"a":[1,2],"b":{}}'), '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {}\n}');
  assert.equal(indentJson('{"a":{"b":"x, {y}: \\"z\\""},"c":[]}'), '{\n  "a": {\n    "b": "x, {y}: \\"z\\""\n  },\n  "c": []\n}');
  // Truncated (invalid) JSON is still indented instead of shown on one line.
  assert.equal(formatJson('{"model":"m","messages":[{"role":"user","content":"hel'), '{\n  "model": "m",\n  "messages": [\n    {\n      "role": "user",\n      "content": "hel');
  assert.equal(formatJson("plain text"), "plain text");
});
