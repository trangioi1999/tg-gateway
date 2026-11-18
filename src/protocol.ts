// Protocol reference: jwadow/kiro-gateway (AGPL-3.0-or-later). See NOTICE.
import { HttpError, type Settings } from "./types.ts";
type Obj = Record<string, any>;
export function object(value: unknown): value is Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const MAX_TOOLS = 256;
const MAX_TOOL_DESCRIPTION = 10_000;
/** Kiro only accepts tool names matching this. */
const KIRO_TOOL_NAME = /^[\w-]{1,64}$/;
/** Deterministic 8-hex-digit FNV-1a hash (keeps shortened tool names stable across turns). */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}
/**
 * Name sent to Kiro for a client tool name: unchanged when Kiro accepts it, otherwise
 * illegal characters become "_" and long names are cut to 55 chars + "_" + hash.
 */
export function kiroToolName(name: string): string {
  if (KIRO_TOOL_NAME.test(name)) return name;
  const clean = name.replace(/[^\w-]/g, "_");
  return clean.length <= 64 && clean !== name
    ? clean + "_" + shortHash(name).slice(0, Math.min(8, 63 - clean.length))
    : clean.slice(0, 55) + "_" + shortHash(name);
}
function invalid(message: string): never {
  throw new HttpError(400, "invalid_request", message);
}
export function modelId(model: string): string {
  return model
    .replace(/-\d{8}$/, "")
    .replace(/(claude-(?:sonnet|haiku|opus)-\d+)-(\d+)$/, "$1.$2");
}
/** Kiro conversation before it is serialized: optimizations rewrite `turns`. */
export interface Conversation {
  id: string;
  /** System prompt; sent prepended to the first user turn. */
  system: string;
  /** Alternating userInputMessage / assistantResponseMessage entries; the last is the current user turn. */
  turns: Obj[];
  tools: Obj[];
}
export function buildPayload(c: Conversation): Obj {
  const turns = c.turns.slice();
  if (c.system) {
    const first = turns[0].userInputMessage;
    turns[0] = {
      userInputMessage: { ...first, content: c.system + "\n\n" + first.content },
    };
  }
  let current = turns.pop()!;
  if (c.tools.length) {
    const message = current.userInputMessage;
    current = {
      userInputMessage: {
        ...message,
        userInputMessageContext: { ...message.userInputMessageContext, tools: c.tools },
      },
    };
  }
  return {
    conversationState: {
      conversationId: c.id,
      chatTriggerType: "MANUAL",
      currentMessage: current,
      ...(turns.length ? { history: turns } : {}),
    },
  };
}
/** Rebuild payload and size estimate after `conversation` changed. */
export function rebuild(p: Prepared) {
  p.payload = buildPayload(p.conversation);
  p.estimatedInput = estimateTokens(JSON.stringify(p.payload));
}
/** `pattern` with `*` wildcards, matched against a whole tool name. */
const toolPattern = (pattern: string) =>
  new RegExp("^" + pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join(".*") + "$");
/** Whether Settings → tool allow/deny lists let this tool's definition be sent to Kiro. */
export function toolAllowed(name: string, allow: string[] = [], deny: string[] = []): boolean {
  if (deny.some((p) => toolPattern(p).test(name))) return false;
  return !allow.length || allow.some((p) => toolPattern(p).test(name));
}
/** Estimated tokens of one client tool definition; `dropped` = not sent (Settings lists). */
export interface ToolSize {
  name: string;
  tokens: number;
  dropped?: boolean;
}
export interface Prepared {
  model: string;
  conversation: Conversation;
  stream: boolean;
  includeUsage: boolean;
  /** Request fields accepted but not forwarded upstream. */
  ignored: string[];
  /** Client's max_tokens / max_completion_tokens (Kiro itself has no output limit). */
  maxTokens?: number;
  /** stop_sequences (Anthropic) / stop (OpenAI); Kiro has none, applied by the gateway. */
  stopSequences: string[];
  /** Kiro tool name → client tool name, for tools renamed to fit Kiro's naming rules. */
  toolNames: Map<string, string>;
  /** Every tool the client sent, largest first, with those left out by the settings. */
  toolSizes: ToolSize[];
  payload: Obj;
  estimatedInput: number;
}
export function estimateTokens(text: string): number {
  return text ? Math.ceil(new TextEncoder().encode(text).length / 4) : 0;
}
export function credits(
  input: number,
  output: number,
  s: Pick<Settings, "inputCreditsPerMillion" | "outputCreditsPerMillion">,
): number {
  return (
    (input * s.inputCreditsPerMillion + output * s.outputCreditsPerMillion) /
    1e6
  );
}
function textContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) => {
        if (!object(b) || b.type !== "text" || typeof b.text !== "string")
          invalid("Only text content blocks are supported in this version.");
        return b.text;
      })
      .join("\n");
  return invalid("Content must be text or text blocks.");
}
/** Tool result text; images/documents (e.g. Read on a PNG) become a note, Kiro takes text only. */
function resultContent(content: unknown): string {
  if (!Array.isArray(content)) return textContent(content);
  return content
    .map((b) =>
      object(b) && b.type === "text" && typeof b.text === "string"
        ? b.text
        : object(b) && typeof b.type === "string"
          ? `[${b.type} omitted: the Kiro route accepts text only]`
          : invalid("Invalid tool result content."),
    )
    .join("\n");
}
const MAX_STOP_SEQUENCES = 16;
/** Validated stop sequences: a string or an array of non-empty strings. */
function stopList(value: unknown): string[] {
  if (value == null) return [];
  const list = typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(list) ||
    list.length > MAX_STOP_SEQUENCES ||
    !list.every((v) => typeof v === "string" && v.length > 0 && v.length <= 1000)
  )
    invalid(`Stop sequences must be up to ${MAX_STOP_SEQUENCES} non-empty strings.`);
  return [...new Set(list as string[])];
}
export function prepare(
  body: unknown,
  mode: "openai" | "anthropic",
  settings: Settings,
  profileArn?: string,
): Prepared {
  if (
    !object(body) ||
    typeof body.model !== "string" ||
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > 500
  )
    invalid("A model and 1–500 messages are required.");
  const model = modelId(body.model);
  if (!settings.models.map(modelId).includes(model))
    invalid("Model is not enabled. Check /v1/models and Settings.");
  if (body.stream !== undefined && typeof body.stream !== "boolean")
    invalid("stream must be boolean.");
  // Sampling/thinking hints change style, not the shape of the answer. Clients such as
  // Claude Code always send them, so they are dropped and reported via a response header.
  const ignored = ["thinking", "temperature", "top_p", "top_k"].filter(
    (field) => body[field] != null,
  );
  // Reject semantics that cannot be faithfully translated, rather than silently ignoring them.
  for (const field of [
    "response_format",
    "reasoning_effort",
    "seed",
    "logprobs",
    "frequency_penalty",
    "presence_penalty",
  ])
    if (body[field] != null)
      invalid(`${field} is not supported by this adapter.`);
  if (body.n != null && body.n !== 1) invalid("Only n=1 is supported.");
  const stopSequences = stopList(body[mode === "openai" ? "stop" : "stop_sequences"]);
  if (
    body.tool_choice != null &&
    body.tool_choice !== "auto" &&
    !(object(body.tool_choice) && body.tool_choice.type === "auto")
  )
    invalid("Only automatic tool choice is supported.");
  for (const field of ["max_tokens", "max_completion_tokens"])
    if (
      body[field] != null &&
      (!Number.isInteger(body[field]) || body[field] < 1)
    )
      invalid(`${field} must be a positive integer.`);
  const tools = body.tools ?? [];
  // Claude Code with several MCP servers easily sends 100+ tools.
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS)
    invalid(`At most ${MAX_TOOLS} tools are supported.`);
  // Client name → Kiro name. Names Kiro rejects (over 64 chars, dots, colons…, common with
  // MCP servers) are renamed and mapped back when Kiro calls the tool.
  const names = new Map<string, string>();
  const toolNames = new Map<string, string>();
  const longDocs: string[] = [];
  const kiroTools: Obj[] = [];
  const toolSizes: ToolSize[] = [];
  for (const t of tools) {
    if (!object(t)) invalid("Invalid tool.");
    const f = mode === "openai" ? t.function : t;
    if (!object(f) || typeof f.name !== "string" || !f.name || f.name.length > 256)
      invalid("Every tool needs a name of 1–256 characters.");
    if (mode === "openai" && t.type !== "function")
      invalid("Only function tools are supported.");
    const schema = mode === "openai" ? f.parameters : f.input_schema;
    if (schema != null && !object(schema))
      invalid(`Tool schema must be an object (tool ${f.name.slice(0, 80)}).`);
    // The same tool listed twice (e.g. by two MCP configs): keep the first definition.
    if (names.has(f.name) || toolSizes.some((t) => t.name === f.name)) continue;
    const tokens = estimateTokens(JSON.stringify({ name: f.name, description: f.description ?? "", schema: schema ?? {} }));
    // Left out by Settings: Kiro never sees it; earlier calls to it become text (pairTools).
    if (!toolAllowed(f.name, settings.toolAllowlist, settings.toolDenylist)) {
      toolSizes.push({ name: f.name, tokens, dropped: true });
      continue;
    }
    toolSizes.push({ name: f.name, tokens });
    let kiroName = kiroToolName(f.name);
    for (let n = 2; toolNames.has(kiroName); n++)
      kiroName = kiroToolName(f.name).slice(0, 60) + "_" + n;
    names.set(f.name, kiroName);
    toolNames.set(kiroName, f.name);
    let description =
      typeof f.description === "string" && f.description ? f.description : `Tool ${f.name}`;
    // Kiro rejects very long tool descriptions; move them into the system prompt instead.
    if (description.length > MAX_TOOL_DESCRIPTION) {
      longDocs.push(`## Tool: ${f.name}\n\n${description}`);
      description = `[Full documentation in the system prompt under "## Tool: ${f.name}"]`;
    }
    kiroTools.push({
      toolSpecification: {
        name: kiroName,
        description,
        inputSchema: { json: schema ?? { type: "object", properties: {} } },
      },
    });
  }
  const history: Obj[] = [];
  let system = mode === "anthropic" ? textContent(body.system) : "";
  if (longDocs.length)
    system = [system, "# Tool documentation", ...longDocs].filter(Boolean).join("\n\n");
  for (const message of body.messages) {
    if (!object(message) || typeof message.role !== "string")
      invalid("Invalid message.");
    if (["system", "developer"].includes(message.role)) {
      system += "\n" + textContent(message.content);
      continue;
    }
    let role = message.role,
      content = "",
      toolUses: Obj[] = [],
      toolResults: Obj[] = [];
    if (role === "tool") {
      if (mode !== "openai" || typeof message.tool_call_id !== "string")
        invalid("Invalid tool result.");
      role = "user";
      toolResults.push({
        toolUseId: message.tool_call_id,
        content: [{ text: textContent(message.content) || "(empty result)" }],
        status: "success",
      });
    } else if (mode === "anthropic" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!object(block)) invalid("Invalid content block.");
        if (block.type === "text")
          content += (content ? "\n" : "") + textContent(block.text);
        // Reasoning from an earlier model (e.g. the session started on anthropic/): Kiro
        // has no field for it and the answer text already carries the outcome.
        else if (block.type === "thinking" || block.type === "redacted_thinking") continue;
        else if (block.type === "tool_use" && role === "assistant") {
          if (
            typeof block.id !== "string" ||
            typeof block.name !== "string" ||
            !object(block.input)
          )
            invalid("Invalid tool use.");
          toolUses.push({
            toolUseId: block.id,
            name: block.name,
            input: block.input,
          });
        } else if (block.type === "tool_result" && role === "user") {
          if (typeof block.tool_use_id !== "string")
            invalid("Invalid tool result ID.");
          toolResults.push({
            toolUseId: block.tool_use_id,
            content: [{ text: resultContent(block.content) || "(empty result)" }],
            status: block.is_error ? "error" : "success",
          });
        } else
          invalid(
            "Unsupported content block. This version supports text and tool calls.",
          );
      }
    } else content = textContent(message.content);
    if (role !== "user" && role !== "assistant")
      invalid("Unsupported message role.");
    if (message.tool_calls != null) {
      if (role !== "assistant" || !Array.isArray(message.tool_calls))
        invalid("Invalid tool_calls.");
      toolUses = message.tool_calls.map((t: Obj) => {
        if (
          !object(t) ||
          typeof t.id !== "string" ||
          !object(t.function) ||
          typeof t.function.name !== "string" ||
          typeof t.function.arguments !== "string"
        )
          invalid("Invalid tool call.");
        let input;
        try {
          input = JSON.parse(t.function.arguments);
        } catch {
          invalid("Tool arguments must be valid JSON.");
        }
        if (!object(input)) invalid("Tool arguments must be an object.");
        return { toolUseId: t.id, name: t.function.name, input };
      });
    }
    const key =
      role === "user" ? "userInputMessage" : "assistantResponseMessage";
    const value: Obj = { content: content || "(empty)" };
    if (role === "user") {
      value.modelId = model;
      value.origin = "AI_EDITOR";
      if (toolResults.length) value.userInputMessageContext = { toolResults };
    }
    if (toolUses.length) value.toolUses = toolUses;
    const previous = history.at(-1)?.[key];
    if (previous) {
      previous.content += "\n" + value.content;
      if (toolResults.length) {
        previous.userInputMessageContext ??= { toolResults: [] };
        previous.userInputMessageContext.toolResults.push(...toolResults);
      }
      if (toolUses.length) {
        previous.toolUses ??= [];
        previous.toolUses.push(...toolUses);
      }
    } else history.push({ [key]: value });
  }
  if (!history.length) invalid("At least one user message is required.");
  if (!history[0].userInputMessage)
    history.unshift({
      userInputMessage: {
        content: "Continue the conversation.",
        modelId: model,
        origin: "AI_EDITOR",
      },
    });
  if (!history.at(-1)!.userInputMessage)
    history.push({
      userInputMessage: {
        content: "Continue.",
        modelId: model,
        origin: "AI_EDITOR",
      },
    });
  pairTools(history, names);
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    system: system.trim(),
    turns: history,
    tools: kiroTools,
  };
  const payload = buildPayload(conversation);
  if (profileArn) payload.profileArn = profileArn;
  // Kiro upstream does not expose a verified max_tokens field here. It is accepted as a compatibility hint only (documented).
  return {
    model,
    conversation,
    stream: body.stream === true,
    includeUsage: body.stream_options?.include_usage === true,
    ignored,
    maxTokens: body.max_tokens ?? body.max_completion_tokens,
    stopSequences,
    toolNames: new Map([...toolNames].filter(([kiro, client]) => kiro !== client)),
    toolSizes: toolSizes.sort((a, b) => b.tokens - a.tokens),
    payload,
    estimatedInput: estimateTokens(JSON.stringify(payload)),
  };
}

const FLATTENED_CHARS = 4000;
function appendText(message: Obj, text: string, before = false) {
  const current = message.content === "(empty)" ? "" : message.content;
  message.content = [before ? text : current, before ? current : text].filter(Boolean).join("\n");
}
/**
 * Kiro needs every tool call answered in the very next user turn and declared in this
 * request's tool list. Claude Code breaks both routinely: compaction/title requests resend
 * the history without `tools`, MCP servers come and go mid-session, interrupted calls have
 * no result. Instead of rejecting the request, calls and results that cannot be paired are
 * kept as plain text; paired calls get their Kiro tool name.
 */
export function pairTools(history: Obj[], names: Map<string, string>) {
  const seen = new Set<string>();
  for (let i = 0; i < history.length; i++) {
    const assistant = history[i].assistantResponseMessage;
    if (!assistant?.toolUses?.length) continue;
    const next = history[i + 1]?.userInputMessage;
    const answered = new Set<string>(
      (next?.userInputMessageContext?.toolResults ?? []).map((r: Obj) => r.toolUseId),
    );
    const kept: Obj[] = [];
    for (const use of assistant.toolUses) {
      if (names.has(use.name) && answered.has(use.toolUseId) && !seen.has(use.toolUseId)) {
        seen.add(use.toolUseId);
        kept.push({ ...use, name: names.get(use.name) });
      } else
        appendText(
          assistant,
          `[Called tool ${use.name} (${use.toolUseId}) with ${clipText(JSON.stringify(use.input), FLATTENED_CHARS)}]`,
        );
    }
    if (kept.length) assistant.toolUses = kept;
    else delete assistant.toolUses;
  }
  for (let i = 0; i < history.length; i++) {
    const user = history[i].userInputMessage;
    const results: Obj[] | undefined = user?.userInputMessageContext?.toolResults;
    if (!results?.length) continue;
    const calls = new Set<string>(
      (history[i - 1]?.assistantResponseMessage?.toolUses ?? []).map((u: Obj) => u.toolUseId),
    );
    const kept: Obj[] = [];
    const loose: string[] = [];
    for (const r of results) {
      if (calls.has(r.toolUseId)) {
        calls.delete(r.toolUseId);
        kept.push(r);
      } else
        loose.push(
          `[Result of tool call ${r.toolUseId}${r.status === "error" ? " (error)" : ""}: ${clipText(r.content.map((c: Obj) => c.text).join(""), FLATTENED_CHARS)}]`,
        );
    }
    if (loose.length) appendText(user, loose.join("\n"), true);
    if (kept.length) user.userInputMessageContext.toolResults = kept;
    else {
      delete user.userInputMessageContext.toolResults;
      if (!Object.keys(user.userInputMessageContext).length) delete user.userInputMessageContext;
    }
  }
}
const clipText = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) + ` … [${text.length - max} more chars]` : text;

export interface WireEvent {
  headers: Record<string, string>;
  data: Obj;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export class EventDecoder {
  buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  feed(chunk: Uint8Array): WireEvent[] {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer);
    next.set(chunk, this.buffer.length);
    this.buffer = next;
    const events: WireEvent[] = [];
    while (this.buffer.length >= 12) {
      const view = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset,
        this.buffer.byteLength,
      );
      const total = view.getUint32(0),
        headerSize = view.getUint32(4);
      if (
        crc32(this.buffer.subarray(0, 8)) !== view.getUint32(8) ||
        total < 16 ||
        headerSize > total - 16 ||
        total > 32 * 1024 * 1024
      )
        throw new HttpError(
          502,
          "invalid_upstream_stream",
          "Invalid upstream frame.",
        );
      if (this.buffer.length < total) break;
      if (
        crc32(this.buffer.subarray(0, total - 4)) !== view.getUint32(total - 4)
      )
        throw new HttpError(
          502,
          "invalid_upstream_stream",
          "Upstream checksum failed.",
        );
      const headers: Record<string, string> = {};
      let p = 12;
      const end = 12 + headerSize;
      const dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
      while (p < end) {
        const size = this.buffer[p++];
        if (!size || p + size + 1 > end)
          throw new Error("Invalid event header");
        const name = dec.decode(this.buffer.subarray(p, p + size));
        p += size;
        const type = this.buffer[p++];
        if (type === 6 || type === 7) {
          if (p + 2 > end) throw new Error("Invalid event header");
          const len = view.getUint16(p);
          p += 2;
          if (p + len > end) throw new Error("Invalid event header");
          if (type === 7)
            headers[name] = dec.decode(this.buffer.subarray(p, p + len));
          p += len;
        } else {
          const widths: Record<number, number> = {
            0: 0,
            1: 0,
            2: 1,
            3: 2,
            4: 4,
            5: 8,
            8: 8,
            9: 16,
          };
          if (widths[type] === undefined)
            throw new Error("Invalid event header type");
          p += widths[type];
          if (p > end) throw new Error("Invalid event header");
        }
      }
      const text = dec.decode(this.buffer.subarray(end, total - 4));
      const data = text ? JSON.parse(text) : {};
      if (!object(data)) throw new Error("Invalid event payload");
      events.push({ headers, data });
      this.buffer = this.buffer.slice(total);
    }
    return events;
  }
  finish() {
    if (this.buffer.length)
      throw new HttpError(
        502,
        "truncated_stream",
        "Upstream stream ended inside a frame.",
      );
  }
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export class Completion {
  text = "";
  tools: ToolCall[] = [];
  inputTokens: number;
  outputTokens = 0;
  inputSource = "estimated";
  outputSource = "estimated";
  reportedCredits: number | null = null;
  contextPercent: number | null = null;
  terminal = false;
  /** Set when the answer stopped for a reason other than end of turn / tool use. */
  stopReason?: "max_tokens" | "stop_sequence";
  /** The stop sequence that ended the answer (it is not part of `text`). */
  stopSequence?: string;
  /**
   * Kiro cannot stop on a sequence, so the gateway cuts the text at the first match and
   * drops whatever Kiro sends after it. Text that could be the start of a sequence is held
   * back until the next chunk shows it is not.
   */
  stopSequences: string[] = [];
  /** Characters of `text` already handed out by accept(). */
  private released = 0;
  /** Kiro tool name → client tool name (see Prepared.toolNames). */
  toolNames?: Map<string, string>;
  active?: ToolCall;
  constructor(estimatedInput: number) {
    this.inputTokens = estimatedInput;
  }
  accept({ headers, data: raw }: WireEvent): {
    text?: string;
    tool?: ToolCall;
  } {
    if (["exception", "error"].includes(headers[":message-type"]))
      throw new HttpError(
        502,
        "upstream_stream_error",
        "Kiro returned a stream error.",
      );
    const type = headers[":event-type"] ?? "";
    const d = object(raw[type]) ? raw[type] : raw;
    const stopped = this.stopReason === "stop_sequence";
    if (type === "assistantResponseEvent" && typeof d.content === "string") {
      if (stopped) return {};
      if (!this.stopSequences.length) {
        this.text += d.content;
        return { text: d.content };
      }
      const from = Math.max(0, this.text.length - this.longestStop() + 1);
      this.text += d.content;
      let cut = -1;
      for (const seq of this.stopSequences) {
        const at = this.text.indexOf(seq, from);
        if (at >= 0 && (cut < 0 || at < cut)) {
          cut = at;
          this.stopSequence = seq;
        }
      }
      if (cut >= 0) {
        this.text = this.text.slice(0, cut);
        this.stopReason = "stop_sequence";
        return this.release(this.text.length);
      }
      return this.release(this.text.length - this.longestStop() + 1);
    }
    if (stopped && type === "toolUseEvent") return {};
    if (type === "toolUseEvent") {
      if (typeof d.name === "string") {
        if (this.active && this.active.id !== d.toolUseId)
          throw new HttpError(
            502,
            "incomplete_tool",
            "Kiro did not finish a tool call.",
          );
        if (!this.active)
          this.active = {
            id: d.toolUseId || crypto.randomUUID(),
            name: d.name,
            arguments: "",
          };
      }
      if (this.active && d.input != null)
        this.active.arguments +=
          typeof d.input === "string"
            ? d.input
            : object(d.input) && !Object.keys(d.input).length
              ? ""
              : JSON.stringify(d.input);
      if (d.stop && this.active) {
        const tool = this.active;
        tool.arguments ||= "{}";
        let parsed;
        try {
          parsed = JSON.parse(tool.arguments);
        } catch {
          throw new HttpError(
            502,
            "invalid_tool_arguments",
            "Kiro returned incomplete tool arguments.",
          );
        }
        if (!object(parsed))
          throw new HttpError(
            502,
            "invalid_tool_arguments",
            "Tool arguments must be an object.",
          );
        tool.name = this.toolNames?.get(tool.name) ?? tool.name;
        this.tools.push(tool);
        this.active = undefined;
        // Text held back for stop sequences goes out before the tool call.
        return { ...this.release(this.text.length), tool };
      }
    }
    if (
      type === "meteringEvent" &&
      typeof d.usage === "number" &&
      Number.isFinite(d.usage) &&
      d.usage >= 0
    ) {
      this.reportedCredits = d.usage;
      this.terminal = true;
    }
    if (typeof d.contextUsagePercentage === "number") {
      this.contextPercent = d.contextUsagePercentage;
      this.terminal = true;
    }
    const usage = object(d.usage) ? d.usage : d;
    if (Number.isInteger(usage.inputTokens) && usage.inputTokens >= 0) {
      this.inputTokens = usage.inputTokens;
      this.inputSource = "reported";
    }
    if (Number.isInteger(usage.outputTokens) && usage.outputTokens >= 0) {
      this.outputTokens = usage.outputTokens;
      this.outputSource = "reported";
    }
    return {};
  }
  private longestStop() {
    return Math.max(1, ...this.stopSequences.map((s) => s.length));
  }
  /** Hands out text up to `upTo` that has not been handed out yet. */
  private release(upTo: number): { text?: string } {
    if (upTo <= this.released) return {};
    const text = this.text.slice(this.released, upTo);
    this.released = upTo;
    return { text };
  }
  /** Text still held back when the stream ends. */
  flush(): string {
    return this.release(this.text.length).text ?? "";
  }
  finalize() {
    if (this.outputSource === "estimated")
      this.outputTokens = estimateTokens(
        this.text +
          this.tools.map((t) => t.name + t.arguments).join("") +
          (this.active?.arguments ?? ""),
      );
  }
  /**
   * A half-received tool call is unusable, so it fails the request. A clean end of
   * stream without metering/context events is accepted; callers flag it via `terminal`
   * so an upstream protocol change does not turn delivered answers into errors.
   */
  validateEnd() {
    this.finalize();
    if (this.active)
      throw new HttpError(
        502,
        "incomplete_stream",
        "Kiro closed the stream in the middle of a tool call.",
      );
  }
  usage() {
    return {
      prompt_tokens: this.inputTokens,
      completion_tokens: this.outputTokens,
      total_tokens: this.inputTokens + this.outputTokens,
    };
  }
}
