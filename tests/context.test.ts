import { test } from "node:test";
import assert from "node:assert/strict";
import { prepare, buildPayload } from "../src/protocol.ts";
import { defaults } from "../src/types.ts";
import { clearToolResults, CLEARED_RESULT, conversationTokens } from "../src/context.ts";

const tool = { name: "Read", description: "Read a file", input_schema: { type: "object", properties: {} } };
/** Anthropic conversation with `rounds` Read calls, each returning `size` characters. */
function session(rounds: number, size = 4000) {
  const messages: any[] = [{ role: "user", content: "fix the bug" }];
  for (let i = 0; i < rounds; i++) {
    messages.push({
      role: "assistant",
      content: [{ type: "tool_use", id: `t${i}`, name: "Read", input: { path: `f${i}.ts`, note: "y".repeat(500) } }],
    });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `${i}:` + "x".repeat(size) }],
    });
  }
  return prepare({ model: defaults.models[0], system: "Sys.", tools: [tool], messages }, "anthropic", defaults);
}
const opts = { triggerTokens: 1000, keepToolUses: 2, clearInputs: false };
const results = (turns: any[]) =>
  turns.flatMap((t) => t.userInputMessage?.userInputMessageContext?.toolResults ?? []);

test("buildPayload reproduces the prepared payload", () => {
  const p = session(3);
  assert.deepEqual(buildPayload(p.conversation), p.payload);
});

test("below the trigger nothing changes", () => {
  const p = session(3);
  const r = clearToolResults(p.conversation, { ...opts, triggerTokens: 1_000_000 });
  assert.equal(r.cleared, 0);
  assert.equal(r.turns, p.conversation.turns);
});

test("old results are cleared, recent ones and the current turn kept, pairs intact", () => {
  const p = session(6);
  const before = JSON.stringify(p.conversation.turns);
  const r = clearToolResults(p.conversation, opts);
  assert.equal(JSON.stringify(p.conversation.turns), before, "input not mutated");
  assert.equal(r.turns.length, p.conversation.turns.length);
  const all = results(r.turns);
  // t5 is the current turn's result (never cleared); t4, t5 are the 2 kept tool uses.
  assert.deepEqual(
    all.map((x) => x.content[0].text === CLEARED_RESULT),
    [true, true, true, true, false, false],
  );
  assert.deepEqual(all.map((x) => x.toolUseId), ["t0", "t1", "t2", "t3", "t4", "t5"]);
  const current = r.turns.at(-1)!.userInputMessage.userInputMessageContext.toolResults[0];
  assert.match(current.content[0].text, /^5:/);
  assert.equal(r.cleared, 4);
  assert.ok(r.savedTokens > 3000);
  assert.ok(conversationTokens({ ...p.conversation, turns: r.turns }) < conversationTokens(p.conversation));
  // Deterministic.
  assert.deepEqual(clearToolResults(p.conversation, opts).turns, r.turns);
});

test("short results are left alone; keep=0 clears every old result", () => {
  const short = clearToolResults(session(6, 50).conversation, { ...opts, triggerTokens: 100 });
  assert.equal(short.cleared, 0);
  const all = clearToolResults(session(4).conversation, { ...opts, keepToolUses: 0 });
  assert.equal(all.cleared, 3);
});

test("clearInputs shortens long strings in old tool arguments only", () => {
  const p = session(5);
  const r = clearToolResults(p.conversation, { ...opts, clearInputs: true });
  const uses = r.turns.flatMap((t) => t.assistantResponseMessage?.toolUses ?? []);
  assert.equal(uses[0].input.note, "[cleared by gateway: 500 chars]");
  assert.equal(uses[0].input.path, "f0.ts");
  assert.equal(uses.at(-1).input.note.length, 500);
});
