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

// ---------------------------------------------------------------------------------------
// Compaction: summarize the start of a long conversation once, reuse the summary on every
// later turn. A summary is keyed by a chained hash of the turns it covers, so it is only
// reused for a conversation whose start is byte-identical (no cross-session mixing).

/** Per-item limits when rendering turns for the summarizer. */
const TRANSCRIPT_RESULT_CHARS = 1500;
const TRANSCRIPT_INPUT_CHARS = 500;
const TRANSCRIPT_MAX_CHARS = 500_000;
/** Not worth a summarizer call below this many tokens. */
export const MIN_COMPACT_TOKENS = 4000;

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Turn identity without per-request fields (the model can change between turns). */
function identity(turn: Obj): string {
  const user = turn.userInputMessage;
  if (!user) return JSON.stringify(turn);
  const { modelId: _model, ...rest } = user;
  return JSON.stringify({ userInputMessage: rest });
}

/** hashes[i] identifies turns[0..i]: h_i = sha256(h_{i-1} + turn_i). */
export async function prefixHashes(turns: Obj[]): Promise<string[]> {
  const enc = new TextEncoder();
  const hashes: string[] = [];
  let previous = "";
  for (const turn of turns) {
    previous = hex(
      await crypto.subtle.digest("SHA-256", enc.encode(previous + "\n" + identity(turn))),
    );
    hashes.push(previous);
  }
  return hashes;
}

const turnTokens = (turn: Obj) => estimateTokens(JSON.stringify(turn));

/**
 * Index of the first turn to keep verbatim: the earliest user turn after `from` whose tail
 * fits in `keepTokens`. Falls back to the current (last) turn. Returns `from` when nothing
 * new can be summarized.
 */
export function chooseCut(turns: Obj[], keepTokens: number, from: number): number {
  const last = turns.length - 1;
  let cut = last,
    tail = 0;
  for (let i = last; i > from; i--) {
    tail += turnTokens(turns[i]);
    if (tail > keepTokens) break;
    if (turns[i].userInputMessage) cut = i;
  }
  if (cut <= from) return from;
  const summarized = turns.slice(from, cut).reduce((n, t) => n + turnTokens(t), 0);
  return summarized >= MIN_COMPACT_TOKENS ? cut : from;
}

const clip = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) + `… [${text.length - max} more chars]` : text;

/** Plain-text transcript of `turns` for the summarizer, continuing `previous` if given. */
export function renderTranscript(turns: Obj[], previous = ""): string {
  const lines: string[] = [];
  if (previous) lines.push("## Summary of the conversation before this point", previous, "");
  lines.push("## Conversation");
  for (const turn of turns) {
    const user = turn.userInputMessage,
      assistant = turn.assistantResponseMessage;
    if (user) {
      for (const r of user.userInputMessageContext?.toolResults ?? [])
        lines.push(
          `Tool result (${r.toolUseId}${r.status === "error" ? ", error" : ""}): ${clip(resultText(r), TRANSCRIPT_RESULT_CHARS)}`,
        );
      if (user.content && user.content !== "(empty)") lines.push(`User: ${user.content}`);
    } else if (assistant) {
      if (assistant.content && assistant.content !== "(empty)")
        lines.push(`Assistant: ${assistant.content}`);
      for (const u of assistant.toolUses ?? [])
        lines.push(
          `Assistant called ${u.name} (${u.toolUseId}): ${clip(JSON.stringify(u.input), TRANSCRIPT_INPUT_CHARS)}`,
        );
    }
  }
  const text = lines.join("\n");
  if (text.length <= TRANSCRIPT_MAX_CHARS) return text;
  const head = Math.floor(TRANSCRIPT_MAX_CHARS * 0.2);
  return text.slice(0, head) + "\n[… middle omitted …]\n" + text.slice(text.length - (TRANSCRIPT_MAX_CHARS - head));
}

export function summaryRequest(transcript: string): string {
  return [
    "You are compacting the history of a conversation between a user and an AI coding agent so the agent can continue without the full history.",
    "Write a dense, factual summary that preserves:",
    "- the user's goals, requirements and preferences (quote exact wording when it matters);",
    "- decisions made and why;",
    "- files, functions and identifiers touched, and their current state;",
    "- commands run and the results that still matter (errors, test outcomes);",
    "- what is finished, what is in progress and the next steps.",
    "Do not continue the conversation, do not call tools, output only the summary.",
    "",
    transcript,
  ].join("\n");
}

/**
 * Replace turns[0..cut) with `summary`. The first kept turn is a user turn; its tool results
 * (whose calls were summarized away) become plain text so no tool pair is left dangling.
 */
export function applySummary(turns: Obj[], cut: number, summary: string): Obj[] {
  const tail = turns.slice(cut);
  const first = tail[0].userInputMessage;
  const parts = [`[Summary of the earlier conversation, written by the gateway]\n${summary}\n[End of summary]`];
  const results: Obj[] = first.userInputMessageContext?.toolResults ?? [];
  if (results.length)
    parts.push(
      "Results of the last tool calls:\n" +
        results.map((r) => `- ${r.toolUseId}${r.status === "error" ? " (error)" : ""}: ${resultText(r)}`).join("\n"),
    );
  if (first.content && first.content !== "(empty)") parts.push(first.content);
  const { toolResults: _dropped, ...context } = first.userInputMessageContext ?? {};
  const message: Obj = { ...first, content: parts.join("\n\n") };
  if (Object.keys(context).length) message.userInputMessageContext = context;
  else delete message.userInputMessageContext;
  tail[0] = { userInputMessage: message };
  return tail;
}

// ---------------------------------------------------------------------------------------
// What a Kiro request is made of, for the dashboard (token estimates only, no content).

export interface ContextBreakdown {
  system: number;
  tools: number;
  /** User and assistant text of earlier turns. */
  messages: number;
  toolResults: number;
  toolInputs: number;
  /** The current user turn: new message and the results of the tools it answers. */
  current: number;
}

export function contextBreakdown(c: Conversation): ContextBreakdown {
  const size = (v: unknown) => estimateTokens(typeof v === "string" ? v : JSON.stringify(v ?? ""));
  const b: ContextBreakdown = { system: size(c.system), tools: c.tools.length ? size(c.tools) : 0, messages: 0, toolResults: 0, toolInputs: 0, current: 0 };
  const last = c.turns.length - 1;
  c.turns.forEach((turn, index) => {
    const user = turn.userInputMessage,
      assistant = turn.assistantResponseMessage;
    if (index === last) {
      b.current = size(user?.content) + size(user?.userInputMessageContext?.toolResults ?? "");
      return;
    }
    if (user) {
      b.messages += size(user.content);
      const results = user.userInputMessageContext?.toolResults;
      if (results?.length) b.toolResults += size(results);
    } else if (assistant) {
      b.messages += size(assistant.content);
      if (assistant.toolUses?.length) b.toolInputs += size(assistant.toolUses);
    }
  });
  return b;
}

/**
 * Experimental (Settings → stableConversationId): one Kiro conversationId per conversation
 * thread, derived from the Claude Code session and the thread's first turn (system prompt +
 * first user message), so the main session, each subagent and each classifier call get
 * their own. Formatted as a version-4-style UUID.
 */
export async function stableConversationId(session: string | null, c: Conversation): Promise<string> {
  const first = c.turns[0]?.userInputMessage;
  const seed = JSON.stringify([session ?? "", c.system, first?.content ?? ""]);
  const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  const h = digest.slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
