// Context trimming for the Kiro route. Every Kiro turn resends the whole conversation and
// Kiro has no prompt caching, so old tool output (file contents, command logs) is paid for
// again on every turn. Modeled on Anthropic's clear_tool_uses context edit.
import {
  buildPayload,
  estimateTokens,
  type Conversation,
} from "./protocol.ts";

type Obj = Record<string, any>;

export const CLEARED_RESULT =
  "[Tool result cleared by gateway to save context. Re-run the tool if you need it again.]";
/** Results this short cost less than the placeholder is worth. */
const MIN_RESULT_CHARS = 200;
/** Strings in old tool arguments longer than this are shortened when clearToolInputs is on. */
const MAX_INPUT_STRING = 300;

export interface ClearOptions {
  triggerTokens: number;
  keepToolUses: number;
  clearInputs: boolean;
}
export interface ClearResult {
  turns: Obj[];
  cleared: number;
  savedTokens: number;
}

export const conversationTokens = (c: Conversation) =>
  estimateTokens(JSON.stringify(buildPayload(c)));

const resultText = (r: Obj) =>
  Array.isArray(r.content)
    ? r.content.map((c: Obj) => (typeof c?.text === "string" ? c.text : "")).join("")
    : "";

function shrink(value: unknown): unknown {
  if (typeof value === "string")
    return value.length > MAX_INPUT_STRING
      ? `[cleared by gateway: ${value.length} chars]`
      : value;
  if (Array.isArray(value)) return value.map(shrink);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shrink(v)]),
    );
  return value;
}

/**
 * Returns new turns (input is not mutated, indices are preserved) in which tool results
 * older than the last `keepToolUses` tool calls are replaced by a placeholder. Tool call /
 * result pairs, IDs and error status stay intact; the current turn is never touched.
 * Deterministic: the same conversation always yields the same output.
 */
export function clearToolResults(c: Conversation, o: ClearOptions): ClearResult {
  const before = conversationTokens(c);
  if (before <= o.triggerTokens) return { turns: c.turns, cleared: 0, savedTokens: 0 };
  const order: string[] = [];
  for (const turn of c.turns)
    for (const use of turn.assistantResponseMessage?.toolUses ?? [])
      order.push(use.toolUseId);
  const keep = new Set(o.keepToolUses ? order.slice(-o.keepToolUses) : []);
  let cleared = 0;
  const last = c.turns.length - 1;
  const turns = c.turns.map((turn, index) => {
    if (index === last) return turn;
    const user = turn.userInputMessage;
    const results: Obj[] | undefined = user?.userInputMessageContext?.toolResults;
    if (results?.length) {
      let changed = false;
      const next = results.map((r) => {
        if (keep.has(r.toolUseId) || resultText(r).length <= MIN_RESULT_CHARS) return r;
        changed = true;
        cleared++;
        return { ...r, content: [{ text: CLEARED_RESULT }] };
      });
      return changed
        ? {
            userInputMessage: {
              ...user,
              userInputMessageContext: { ...user.userInputMessageContext, toolResults: next },
            },
          }
        : turn;
    }
    const assistant = turn.assistantResponseMessage;
    if (o.clearInputs && assistant?.toolUses?.length) {
      let changed = false;
      const uses = assistant.toolUses.map((u: Obj) => {
        if (keep.has(u.toolUseId)) return u;
        const input = shrink(u.input);
        if (JSON.stringify(input) === JSON.stringify(u.input)) return u;
        changed = true;
        return { ...u, input };
      });
      return changed ? { assistantResponseMessage: { ...assistant, toolUses: uses } } : turn;
    }
    return turn;
  });
  const after = conversationTokens({ ...c, turns });
  return { turns, cleared, savedTokens: Math.max(0, before - after) };
}
