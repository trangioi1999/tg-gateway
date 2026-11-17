import type { Payload, Step, StepKey, StepState } from "./dashboard/contract.ts";

/** Per-request timeline shown in the dashboard. `at`/`dur` are ms since `start`. */
export class Trace {
  private list: (Step & { open: boolean })[] = [];
  private start: number;
  private clock: () => number;
  constructor(start = Date.now(), clock: () => number = Date.now) {
    this.start = start;
    this.clock = clock;
  }
  mark(key: StepKey, state: StepState, detail = "", dur: number | null = null): void {
    this.list.push({ key, state, at: this.clock() - this.start, dur, detail, open: false });
  }
  /** Starts an active step; the returned closer ends it (once) and sets its duration. */
  begin(key: StepKey, detail = ""): (state?: StepState, detail?: string) => void {
    const step = { key, state: "active" as StepState, at: this.clock() - this.start, dur: null as number | null, detail, open: true };
    this.list.push(step);
    return (state = "done", next) => {
      if (!step.open) return;
      step.open = false;
      step.state = state;
      step.dur = this.clock() - this.start - step.at;
      if (next !== undefined) step.detail = next;
    };
  }
  steps(): Step[] {
    const now = this.clock() - this.start;
    return this.list.map(({ open, ...s }) => (open ? { ...s, state: "active", dur: now - s.at! } : s));
  }
}

const encoder = new TextEncoder();

/** Keeps the first `limit` UTF-8 bytes of each side, never splitting a character. */
export class Capture {
  private request: string | null = null;
  private response: string | null = null;
  private used = 0;
  private cut = false;
  private limit: number;
  constructor(limit = 65_536) {
    this.limit = limit;
  }
  /** Longest prefix of `text` within `room` bytes, and its size in bytes. */
  private take(text: string, room: number): [string, number] {
    const size = encoder.encode(text).byteLength;
    if (size <= room) return [text, size];
    this.cut = true;
    // encodeInto only writes whole characters, so `read` is a safe cut point.
    const { read, written } = encoder.encodeInto(text, new Uint8Array(room));
    return [text.slice(0, read), written];
  }
  setRequest(text: string): void {
    this.request = this.take(text, this.limit)[0];
  }
  append(text: string): void {
    if (!text) return;
    const room = this.limit - this.used;
    if (room <= 0) {
      this.cut = true;
      return;
    }
    const [part, size] = this.take(text, room);
    this.used += size;
    this.response = (this.response ?? "") + part;
  }
  result(): Payload {
    return { request: this.request, response: this.response, truncated: this.cut };
  }
}
