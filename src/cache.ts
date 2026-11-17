// Short-lived, in-memory cache of completed Kiro answers. Clients resend byte-identical
// requests after a dropped connection or their own timeout; without this each resend is
// charged again. Nothing here is written to disk, and it is gone when the Durable Object
// restarts.
import { Completion, type ToolCall } from "./protocol.ts";

type Obj = Record<string, any>;

export interface CachedAnswer {
  text: string;
  tools: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  inputSource: string;
  outputSource: string;
}

const MAX_ENTRIES = 32;
const MAX_ENTRY_CHARS = 2 * 1024 * 1024;

/** Cache key: the Kiro payload without per-request IDs. */
export async function responseKey(payload: Obj): Promise<string> {
  const { profileArn: _arn, conversationState, ...rest } = payload;
  const { conversationId: _id, ...state } = conversationState ?? {};
  const bytes = new TextEncoder().encode(JSON.stringify({ ...rest, conversationState: state }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function snapshot(c: Completion): CachedAnswer {
  return {
    text: c.text,
    tools: c.tools.map((t) => ({ ...t })),
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    inputSource: c.inputSource,
    outputSource: c.outputSource,
  };
}

export function restore(a: CachedAnswer): Completion {
  const c = new Completion(a.inputTokens);
  c.text = a.text;
  c.tools = a.tools.map((t) => ({ ...t }));
  c.outputTokens = a.outputTokens;
  c.inputSource = a.inputSource;
  c.outputSource = a.outputSource;
  c.terminal = true;
  return c;
}

export class ResponseCache {
  private entries = new Map<string, { answer: CachedAnswer; expires: number }>();
  private inflight = new Map<string, Promise<CachedAnswer | null>>();
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(key: string): CachedAnswer | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.answer;
  }

  /** Answer of an identical request that is still running, or null if none / it failed. */
  async wait(key: string): Promise<CachedAnswer | null> {
    return (await this.inflight.get(key)) ?? null;
  }

  /**
   * Mark `key` as running. The returned function must be called exactly once: with the
   * answer to cache it (for `ttlMs`) and release waiters, or with null on failure.
   */
  begin(key: string, ttlMs: number): (answer: CachedAnswer | null) => void {
    let release!: (answer: CachedAnswer | null) => void;
    const promise = new Promise<CachedAnswer | null>((resolve) => (release = resolve));
    this.inflight.set(key, promise);
    let done = false;
    return (answer) => {
      if (done) return;
      done = true;
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
      if (answer) this.set(key, answer, ttlMs);
      release(answer);
    };
  }

  private set(key: string, answer: CachedAnswer, ttlMs: number) {
    if (answer.text.length + JSON.stringify(answer.tools).length > MAX_ENTRY_CHARS) return;
    const now = this.now();
    for (const [k, e] of this.entries) if (e.expires <= now) this.entries.delete(k);
    this.entries.delete(key);
    while (this.entries.size >= MAX_ENTRIES)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { answer, expires: now + ttlMs });
  }

  get size() {
    return this.entries.size;
  }
}
