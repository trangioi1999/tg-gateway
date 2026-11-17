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

import { prefixHashes, chooseCut, renderTranscript, applySummary, MIN_COMPACT_TOKENS } from "../src/context.ts";

test("prefix hashes are chained and ignore the per-turn model", async () => {
  const a = session(3).conversation.turns;
  const b = structuredClone(a);
  for (const t of b) if (t.userInputMessage) t.userInputMessage.modelId = "other-model";
  const ha = await prefixHashes(a),
    hb = await prefixHashes(b);
  assert.equal(ha.length, a.length);
  assert.deepEqual(ha, hb);
  const longer = await prefixHashes([...a, { assistantResponseMessage: { content: "more" } }]);
  assert.deepEqual(longer.slice(0, ha.length), ha, "a longer conversation shares the prefix hashes");
  const changed = structuredClone(a);
  changed[0].userInputMessage.content = "different start";
  assert.notEqual((await prefixHashes(changed)).at(-1), ha.at(-1));
});

test("cut lands on a user turn, keeps the tail under budget, skips tiny prefixes", () => {
  const turns = session(10, 4000).conversation.turns; // ~1000 tokens per tool result
  const cut = chooseCut(turns, 3000, 0);
  assert.ok(cut > 0 && cut < turns.length);
  assert.ok(turns[cut].userInputMessage);
  const tail = turns.slice(cut).reduce((n, t) => n + JSON.stringify(t).length / 4, 0);
  assert.ok(tail <= 3000);
  // Nothing new to summarize after `cut`, or too little before it.
  assert.equal(chooseCut(turns, 3000, cut), cut);
  assert.equal(chooseCut(session(2, 100).conversation.turns, 100, 0), 0);
  assert.ok(MIN_COMPACT_TOKENS > 0);
});

test("summary replaces the prefix; dangling tool results become text", () => {
  const turns = session(4).conversation.turns;
  const cut = 2; // user turn holding the result of t0
  const out = applySummary(turns, cut, "SUMMARY");
  assert.equal(out.length, turns.length - cut);
  const first = out[0].userInputMessage;
  assert.match(first.content, /^\[Summary of the earlier conversation[^\n]*\nSUMMARY\n\[End of summary\]/);
  assert.match(first.content, /Results of the last tool calls:\n- t0: 0:xxx/);
  assert.equal(first.userInputMessageContext, undefined);
  assert.equal(turns[cut].userInputMessage.userInputMessageContext.toolResults.length, 1, "input not mutated");
  const transcript = renderTranscript(turns.slice(0, cut), "OLD");
  assert.match(transcript, /^## Summary of the conversation before this point\nOLD/);
  assert.match(transcript, /User: fix the bug/);
  assert.match(transcript, /Assistant called Read \(t0\)/);
});
