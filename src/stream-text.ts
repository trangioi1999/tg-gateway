// Turns what the gateway sent to a client (Anthropic or OpenAI SSE, or a JSON body) back
// into readable text. Shared by the Worker (live output of running requests) and the
// dashboard (formatted view of captured responses). No DOM or Worker APIs.

type Obj = Record<string, any>;

/** Incremental SSE line reader: feed chunks, get each `data:` JSON (or plain JSON line). */
export class SseReader {
  private buffer = "";
  feed(chunk: string, onData: (data: Obj) => void): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.line(line, onData);
    }
    // A JSON body arrives without a trailing newline; parse it once it is complete.
    if (this.buffer.startsWith("{") && this.buffer.endsWith("}")) {
      const parsed = parse(this.buffer);
      if (parsed) {
        this.buffer = "";
        onData(parsed);
      }
    }
  }
  private line(line: string, onData: (data: Obj) => void) {
    const text = line.startsWith("data:") ? line.slice(5).trim() : line.startsWith("{") ? line : "";
    if (!text || text === "[DONE]") return;
    const parsed = parse(text);
    if (parsed) onData(parsed);
  }
}

function parse(text: string): Obj | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  json?: string;
  input?: unknown;
}

/**
 * Rebuilds the message from stream events. `onText` receives readable pieces as they
 * arrive (answer text, thinking, tool calls), used for the live view.
 */
export class Assembler {
  model = "";
  stop: string | null = null;
  usage: Obj | null = null;
  error: Obj | null = null;
  blocks: Block[] = [];
  /** OpenAI tool calls by index. */
  private calls = new Map<number, Block>();
  private onText: (text: string) => void;
  constructor(onText: (text: string) => void = () => {}) {
    this.onText = onText;
  }
  add(data: Obj): void {
    if (data.type === "error" || (data.error && !data.choices)) {
      this.error = data.error ?? data;
      this.onText(`\n✕ ${data.error?.type ?? data.error?.code ?? "error"}: ${data.error?.message ?? ""}\n`);
      return;
    }
    if (typeof data.type === "string") this.anthropic(data);
    else if (Array.isArray(data.choices)) this.openai(data);
  }
  private anthropic(data: Obj) {
    switch (data.type) {
      case "message_start":
        this.model = data.message?.model ?? this.model;
        this.usage = { ...data.message?.usage };
        break;
      case "content_block_start": {
        const b = data.content_block ?? {};
        const block: Block = { type: b.type ?? "text" };
        if (b.type === "tool_use") {
          block.id = b.id;
          block.name = b.name;
          block.json = "";
          this.onText(`\n▶ ${b.name ?? "tool"}(`);
        } else if (b.type === "thinking") {
          block.text = "";
          this.onText("\n💭 ");
        } else block.text = b.text ?? "";
        this.blocks[data.index ?? this.blocks.length] = block;
        break;
      }
      case "content_block_delta": {
        const block = this.blocks[data.index] ?? (this.blocks[data.index] = { type: "text", text: "" });
        const d = data.delta ?? {};
        const piece = d.text ?? d.thinking ?? d.partial_json ?? "";
        if (d.type === "input_json_delta") block.json = (block.json ?? "") + piece;
        else if (d.type === "text_delta" || d.type === "thinking_delta") block.text = (block.text ?? "") + piece;
        if (piece) this.onText(piece);
        break;
      }
      case "content_block_stop": {
        const block = this.blocks[data.index];
        if (block?.type === "tool_use") this.onText(")\n");
        else if (block?.type === "thinking") this.onText("\n");
        break;
      }
      case "message_delta":
        this.stop = data.delta?.stop_reason ?? this.stop;
        this.usage = { ...this.usage, ...data.usage };
        break;
      case "message": {
        // Non-streamed Anthropic body.
        this.model = data.model ?? this.model;
        this.stop = data.stop_reason ?? null;
        this.usage = data.usage ?? null;
        for (const c of data.content ?? []) {
          this.blocks.push({ type: c.type, text: c.text ?? c.thinking, id: c.id, name: c.name, input: c.input });
          if (c.type === "tool_use") this.onText(`\n▶ ${c.name}(${JSON.stringify(c.input)})\n`);
          else if (c.text ?? c.thinking) this.onText(c.text ?? c.thinking);
        }
        break;
      }
    }
  }
  private openai(data: Obj) {
    this.model = data.model ?? this.model;
    if (data.usage) this.usage = data.usage;
    const choice = data.choices[0];
    if (!choice) return;
    if (choice.finish_reason) this.stop = choice.finish_reason;
    const delta = choice.delta ?? choice.message ?? {};
    if (typeof delta.content === "string" && delta.content) {
      let text = this.blocks.find((b) => b.type === "text");
      if (!text) this.blocks.push((text = { type: "text", text: "" }));
      text.text += delta.content;
      this.onText(delta.content);
    }
    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? this.calls.size;
      let block = this.calls.get(index);
      if (!block) {
        block = { type: "tool_use", id: call.id, name: call.function?.name ?? "", json: "" };
        this.calls.set(index, block);
        this.blocks.push(block);
        this.onText(`\n▶ ${block.name || "tool"}(`);
      }
      const args = call.function?.arguments ?? "";
      block.json += args;
      if (args) this.onText(args);
    }
  }
  /** The message as one object (tool inputs parsed when complete). */
  result(): Obj {
    return {
      ...(this.model ? { model: this.model } : {}),
      stop_reason: this.stop,
      ...(this.error ? { error: this.error } : {}),
      content: this.blocks.filter(Boolean).map((b) => {
        if (b.type !== "tool_use") return { type: b.type, text: b.text ?? "" };
        let input: unknown = b.input;
        if (input === undefined) {
          try {
            input = b.json ? JSON.parse(b.json) : {};
          } catch {
            input = b.json;
          }
        }
        return { type: "tool_use", id: b.id, name: b.name, input };
      }),
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }
}

/** Whole captured response → assembled message, or null if nothing was recognized. */
export function assemble(text: string): Obj | null {
  const assembler = new Assembler();
  let events = 0;
  const reader = new SseReader();
  reader.feed(text + "\n", (data) => {
    events++;
    assembler.add(data);
  });
  return events ? assembler.result() : null;
}

/**
 * Readable output of a running request, kept in memory only while it runs. Holds the last
 * `limit` characters; `total` counts everything produced so a viewer can ask for what is
 * new since its last poll.
 */
export class LiveOutput {
  total = 0;
  bytes = 0;
  private tail = "";
  private limit: number;
  private reader = new SseReader();
  private assembler: Assembler;
  constructor(limit = 32_768) {
    this.limit = limit;
    this.assembler = new Assembler((text) => this.push(text));
  }
  private push(text: string) {
    this.total += text.length;
    this.tail += text;
    if (this.tail.length > this.limit * 2) this.tail = this.tail.slice(-this.limit);
  }
  append(chunk: string): void {
    if (!chunk) return;
    this.bytes += chunk.length;
    this.reader.feed(chunk, (data) => this.assembler.add(data));
  }
  /** Text produced after `since` (as much of it as is still held). */
  since(since: number): { from: number; text: string; total: number } {
    const kept = this.tail.slice(-this.limit);
    const start = this.total - kept.length;
    const from = Math.max(start, Math.min(since, this.total));
    return { from, text: kept.slice(from - start), total: this.total };
  }
}
