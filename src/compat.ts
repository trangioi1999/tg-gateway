/**
 * OpenAI-compatible upstreams (OpenRouter, deploy.com, ...).
 *
 * Clients speak either OpenAI chat completions or Anthropic messages; these upstreams
 * speak OpenAI chat completions. This module routes a model ID to a provider, converts
 * requests, and converts responses (JSON and SSE) back to the client's dialect while
 * metering usage for the ledger.
 */
import { HttpError, type Env, type Settings } from "./types.ts";
import { estimateTokens, modelId, object } from "./protocol.ts";
import { detectAgent } from "./clients.ts";
import type { ApiMode } from "./stream.ts";

type Obj = Record<string, any>;

export interface Provider {
  id: "openrouter" | "deploy" | "anthropic";
  label: string;
  /** Model-ID prefix that selects this provider, e.g. "openrouter/". */
  prefix: string;
  url: string;
  keyEnv: "OPENROUTER_API_KEY" | "DEPLOY_API_KEY" | "ANTHROPIC_API_KEY";
  /** Speaks the Anthropic Messages API natively: requests are forwarded, not converted. */
  native?: boolean;
  /** Provider-specific request fields. */
  extra?: (payload: Obj, thinking: unknown) => void;
}

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    prefix: "anthropic/",
    url: "https://api.anthropic.com/v1/messages",
    keyEnv: "ANTHROPIC_API_KEY",
    native: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    prefix: "openrouter/",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: "OPENROUTER_API_KEY",
    extra(payload, thinking) {
      // Ask OpenRouter to include token counts and cost in the response.
      payload.usage = { include: true };
      if (object(thinking) && thinking.type === "enabled") {
        const budget = Number(thinking.budget_tokens);
        payload.reasoning = Number.isInteger(budget) && budget > 0 ? { max_tokens: budget } : { enabled: true };
      }
    },
  },
  {
    id: "deploy",
    label: "deploy.com",
    prefix: "deploy/",
    url: "https://api-cdn.deploy.com/api/v1/chat/completions",
    keyEnv: "DEPLOY_API_KEY",
    extra(payload, thinking) {
      if (object(thinking) && thinking.type === "disabled") payload.reasoning_effort = "none";
    },
  },
];

export interface Route {
  provider: Provider;
  /** Model ID the client used and the ledger records, e.g. "openrouter/deepseek/deepseek-chat". */
  publicModel: string;
  /** Model ID sent upstream, e.g. "deepseek/deepseek-chat". */
  upstreamModel: string;
}

/** Returns a route for prefixed model IDs, or null for Kiro models. */
export function routeModel(model: unknown, settings: Settings): Route | null {
  if (typeof model !== "string") return null;
  const provider = PROVIDERS.find((p) => model.startsWith(p.prefix));
  if (!provider) return null;
  if (!settings.models.includes(model))
    throw new HttpError(400, "invalid_request", "Model is not enabled. Check /v1/models and Settings.");
  const upstreamModel = model.slice(provider.prefix.length);
  if (!upstreamModel) throw new HttpError(400, "invalid_request", "Model ID is missing after the provider prefix.");
  return { provider, publicModel: model, upstreamModel };
}

export function providerKey(env: Env, provider: Provider): string {
  const key = env[provider.keyEnv];
  if (!key)
    throw new HttpError(503, "credentials_missing", `Set ${provider.keyEnv} in Cloudflare Secrets to use ${provider.label}.`);
  return key;
}

function invalid(message: string): never {
  throw new HttpError(400, "invalid_request", message);
}

function textOf(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) => (object(b) && b.type === "text" && typeof b.text === "string" ? b.text : object(b) && b.type === "image" ? "[image omitted]" : ""))
      .filter(Boolean)
      .join("\n");
  return invalid("Content must be text or content blocks.");
}

function imagePart(block: Obj): Obj {
  const source = block.source;
  if (object(source) && source.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string")
    return { type: "image_url", image_url: { url: `data:${source.media_type};base64,${source.data}` } };
  if (object(source) && source.type === "url" && typeof source.url === "string")
    return { type: "image_url", image_url: { url: source.url } };
  return invalid("Unsupported image source.");
}

/** Anthropic messages request -> OpenAI chat completions messages/tools. */
function fromAnthropic(body: Obj, payload: Obj) {
  const messages: Obj[] = [];
  const system = textOf(body.system);
  if (system) messages.push({ role: "system", content: system });
  for (const message of body.messages) {
    if (!object(message)) invalid("Invalid message.");
    // Claude Code 2.1.x also places system-role entries inside `messages`.
    if (message.role === "system" || message.role === "developer") {
      const text = textOf(message.content);
      if (text) messages.push({ role: "system", content: text });
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") invalid("Unsupported message role.");
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) invalid("Invalid message content.");
    const parts: Obj[] = [];
    const toolCalls: Obj[] = [];
    const toolResults: Obj[] = [];
    for (const block of message.content) {
      if (!object(block)) invalid("Invalid content block.");
      if (block.type === "text") parts.push({ type: "text", text: String(block.text ?? "") });
      else if (block.type === "image" && message.role === "user") parts.push(imagePart(block));
      else if (block.type === "tool_use" && message.role === "assistant") {
        if (typeof block.id !== "string" || typeof block.name !== "string") invalid("Invalid tool use.");
        toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } });
      } else if (block.type === "tool_result" && message.role === "user") {
        if (typeof block.tool_use_id !== "string") invalid("Invalid tool result ID.");
        const text = textOf(block.content) || "(empty result)";
        toolResults.push({ role: "tool", tool_call_id: block.tool_use_id, content: block.is_error ? `Error: ${text}` : text });
      } else if (block.type === "thinking" || block.type === "redacted_thinking") {
        // Reasoning from earlier turns is not replayed upstream.
      } else invalid(`Unsupported content block: ${String(block.type)}.`);
    }
    // OpenAI requires tool results immediately after the assistant turn that called them.
    messages.push(...toolResults);
    const textOnly = parts.every((p) => p.type === "text");
    const content = textOnly ? parts.map((p) => p.text).join("\n") : parts;
    if (message.role === "assistant") {
      if (toolCalls.length || (typeof content === "string" ? content : content.length))
        messages.push({ role: "assistant", content: typeof content === "string" && !content ? null : content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    } else if (typeof content === "string" ? content : content.length) messages.push({ role: "user", content });
  }
  payload.messages = messages;
  if (body.tools != null) {
    if (!Array.isArray(body.tools)) invalid("tools must be an array.");
    payload.tools = body.tools.map((t: unknown) => {
      if (!object(t) || typeof t.name !== "string") invalid("Invalid tool.");
      return {
        type: "function",
        function: {
          name: t.name,
          ...(typeof t.description === "string" ? { description: t.description } : {}),
          parameters: object(t.input_schema) ? t.input_schema : { type: "object", properties: {} },
        },
      };
    });
  }
  const choice = body.tool_choice;
  if (object(choice)) {
    if (choice.type === "auto") payload.tool_choice = "auto";
    else if (choice.type === "any") payload.tool_choice = "required";
    else if (choice.type === "none") payload.tool_choice = "none";
    else if (choice.type === "tool" && typeof choice.name === "string")
      payload.tool_choice = { type: "function", function: { name: choice.name } };
  }
  if (Number.isInteger(body.max_tokens)) payload.max_tokens = body.max_tokens;
  if (Array.isArray(body.stop_sequences)) payload.stop = body.stop_sequences;
  for (const field of ["temperature", "top_p", "top_k"]) if (typeof body[field] === "number") payload[field] = body[field];
}

export interface CompatRequest {
  payload: Obj;
  stream: boolean;
  /** Client asked for a usage chunk (OpenAI stream_options.include_usage). */
  includeUsage: boolean;
  estimatedInput: number;
}

export function toUpstream(body: unknown, mode: ApiMode, route: Route): CompatRequest {
  if (!object(body) || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 2000)
    invalid("A model and 1–2000 messages are required.");
  if (body.stream !== undefined && typeof body.stream !== "boolean") invalid("stream must be boolean.");
  const stream = body.stream === true;
  let payload: Obj;
  if (mode === "openai") {
    // Same dialect: forward the client's fields, only swapping the model.
    const { model: _model, stream_options: _options, ...rest } = body;
    payload = rest;
  } else {
    payload = {};
    fromAnthropic(body, payload);
  }
  payload.model = route.upstreamModel;
  payload.stream = stream;
  if (stream) payload.stream_options = { include_usage: true };
  route.provider.extra?.(payload, mode === "anthropic" ? body.thinking : undefined);
  return {
    payload,
    stream,
    includeUsage: mode === "openai" && body.stream_options?.include_usage === true,
    estimatedInput: estimateTokens(JSON.stringify(payload.messages ?? "")),
  };
}

/** Usage tracked for the ledger. Field names match protocol.Completion. */
export class CompatUsage {
  inputTokens: number;
  outputTokens = 0;
  inputSource = "estimated";
  outputSource = "estimated";
  reportedCredits: number | null = null;
  contextPercent: number | null = null;
  costUsd: number | null = null;
  terminal = true;
  text = "";
  constructor(estimatedInput: number) {
    this.inputTokens = estimatedInput;
  }
  read(usage: unknown) {
    if (!object(usage)) return;
    if (Number.isInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0) {
      this.inputTokens = usage.prompt_tokens;
      this.inputSource = "reported";
    }
    if (Number.isInteger(usage.completion_tokens) && usage.completion_tokens >= 0) {
      this.outputTokens = usage.completion_tokens;
      this.outputSource = "reported";
    }
    if (typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) this.costUsd = usage.cost;
  }
  finalize() {
    if (this.outputSource === "estimated") this.outputTokens = estimateTokens(this.text);
  }
}

const stopReason = (finish: unknown, tools: number) =>
  tools || finish === "tool_calls" ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn";

function parseArguments(raw: string): Obj {
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    if (object(value)) return value;
  } catch {}
  throw new HttpError(502, "invalid_tool_arguments", "Upstream returned invalid tool arguments.");
}

function upstreamError(data: Obj): never {
  const message = object(data.error) && typeof data.error.message === "string" ? data.error.message.slice(0, 300) : "Upstream stream failed.";
  throw new HttpError(502, "upstream_stream_error", message);
}

/** Non-streaming upstream JSON -> client JSON. */
export function fromUpstreamJson(data: unknown, mode: ApiMode, id: string, publicModel: string, usage: CompatUsage): Obj {
  if (!object(data)) throw new HttpError(502, "invalid_upstream", "Upstream returned invalid JSON.");
  if (data.error) upstreamError(data);
  usage.read(data.usage);
  const choice = Array.isArray(data.choices) && object(data.choices[0]) ? data.choices[0] : {};
  const message = object(choice.message) ? choice.message : {};
  usage.text = (typeof message.content === "string" ? message.content : "") + JSON.stringify(message.tool_calls ?? "");
  usage.finalize();
  if (mode === "openai") return { ...data, model: publicModel };
  const tools = Array.isArray(message.tool_calls) ? message.tool_calls.filter(object) : [];
  return {
    id,
    type: "message",
    role: "assistant",
    model: publicModel,
    content: [
      ...(typeof message.content === "string" && message.content ? [{ type: "text", text: message.content }] : []),
      ...tools.map((t: Obj) => ({
        type: "tool_use",
        id: typeof t.id === "string" ? t.id : "toolu_" + crypto.randomUUID(),
        name: t.function?.name,
        input: parseArguments(String(t.function?.arguments ?? "")),
      })),
    ],
    stop_reason: stopReason(choice.finish_reason, tools.length),
    stop_sequence: null,
    usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
  };
}

/**
 * Streaming upstream SSE -> client SSE. `feed` takes raw text chunks and returns text to
 * write to the client; `end` flushes the closing events.
 */
export class CompatStream {
  private buffer = "";
  private textOpen = false;
  private index = 0;
  private finish: unknown = null;
  private done = false;
  private tools = new Map<number, { id: string; name: string; arguments: string }>();
  private mode: ApiMode;
  private id: string;
  private publicModel: string;
  private usage: CompatUsage;
  private includeUsage: boolean;
  constructor(mode: ApiMode, id: string, publicModel: string, usage: CompatUsage, includeUsage: boolean) {
    this.mode = mode;
    this.id = id;
    this.publicModel = publicModel;
    this.usage = usage;
    this.includeUsage = includeUsage;
  }
  private event(type: string, data: unknown) {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  }
  start(): string {
    if (this.mode === "openai") return "";
    return this.event("message_start", {
      type: "message_start",
      message: {
        id: this.id,
        type: "message",
        role: "assistant",
        content: [],
        model: this.publicModel,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: this.usage.inputTokens, output_tokens: 0 },
      },
    });
  }
  feed(chunk: string): string {
    this.buffer += chunk;
    let out = "";
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue; // comments (": OPENROUTER PROCESSING"), event names, blanks
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") {
        this.done = true;
        continue;
      }
      let data: Obj;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new HttpError(502, "invalid_upstream_stream", "Upstream sent malformed SSE data.");
      }
      if (!object(data)) continue;
      if (data.error) upstreamError(data);
      out += this.onChunk(data);
    }
    return out;
  }
  private onChunk(data: Obj): string {
    if (data.usage) this.usage.read(data.usage);
    const choice = Array.isArray(data.choices) && object(data.choices[0]) ? data.choices[0] : null;
    if (choice?.finish_reason) this.finish = choice.finish_reason;
    const delta = object(choice?.delta) ? choice.delta : {};
    if (typeof delta.content === "string") this.usage.text += delta.content;
    if (Array.isArray(delta.tool_calls))
      for (const call of delta.tool_calls) {
        if (!object(call)) continue;
        const index = Number.isInteger(call.index) ? call.index : this.tools.size;
        const tool = this.tools.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof call.id === "string" && call.id) tool.id = call.id;
        if (typeof call.function?.name === "string") tool.name += call.function.name;
        if (typeof call.function?.arguments === "string") tool.arguments += call.function.arguments;
        this.tools.set(index, tool);
        this.usage.text += call.function?.arguments ?? "";
      }
    if (this.mode === "openai") {
      // Same dialect: forward, hiding the usage-only chunk unless the client asked for it.
      if (!choice && data.usage && !this.includeUsage) return "";
      return `data: ${JSON.stringify({ ...data, model: this.publicModel })}\n\n`;
    }
    if (typeof delta.content !== "string" || !delta.content) return "";
    let out = "";
    if (!this.textOpen) {
      out += this.event("content_block_start", { type: "content_block_start", index: this.index, content_block: { type: "text", text: "" } });
      this.textOpen = true;
    }
    return out + this.event("content_block_delta", { type: "content_block_delta", index: this.index, delta: { type: "text_delta", text: delta.content } });
  }
  end(): string {
    if (this.buffer.trim()) this.feed("\n");
    if (!this.done && this.finish === null)
      throw new HttpError(502, "incomplete_stream", "Upstream closed the stream before finishing.");
    this.usage.finalize();
    if (this.mode === "openai") return "data: [DONE]\n\n";
    let out = "";
    if (this.textOpen) {
      out += this.event("content_block_stop", { type: "content_block_stop", index: this.index++ });
      this.textOpen = false;
    }
    // Tool arguments are complete only now; emit each tool block whole.
    for (const tool of [...this.tools.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) {
      const input = parseArguments(tool.arguments);
      const index = this.index++;
      out +=
        this.event("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: tool.id || "toolu_" + crypto.randomUUID(), name: tool.name, input: {} } }) +
        this.event("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) +
        this.event("content_block_stop", { type: "content_block_stop", index });
    }
    return (
      out +
      this.event("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason(this.finish, this.tools.size), stop_sequence: null },
        usage: { input_tokens: this.usage.inputTokens, output_tokens: this.usage.outputTokens },
      }) +
      this.event("message_stop", { type: "message_stop" })
    );
  }
}

/**
 * Native Anthropic passthrough: the client's Messages request is forwarded as-is with
 * only `model` swapped. Meters usage from the SSE events (or JSON body) it relays.
 */
export class AnthropicMeter {
  private buffer = "";
  stopped = false;
  private usage: CompatUsage;
  constructor(usage: CompatUsage) {
    this.usage = usage;
  }
  private take(u: unknown) {
    if (!object(u)) return;
    const input =
      (Number.isInteger(u.input_tokens) ? u.input_tokens : 0) +
      (Number.isInteger(u.cache_read_input_tokens) ? u.cache_read_input_tokens : 0) +
      (Number.isInteger(u.cache_creation_input_tokens) ? u.cache_creation_input_tokens : 0);
    if (Number.isInteger(u.input_tokens)) {
      this.usage.inputTokens = input;
      this.usage.inputSource = "reported";
    }
    if (Number.isInteger(u.output_tokens)) {
      this.usage.outputTokens = u.output_tokens;
      this.usage.outputSource = "reported";
    }
  }
  /** Observe a chunk of the relayed SSE stream. Returns nothing: bytes are forwarded unchanged. */
  observe(text: string) {
    this.buffer += text;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      let data: Obj;
      try {
        data = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (data.type === "message_start") this.take(data.message?.usage);
      else if (data.type === "message_delta") this.take(data.usage);
      else if (data.type === "message_stop") this.stopped = true;
      else if (data.type === "content_block_delta" && typeof data.delta?.text === "string")
        this.usage.text += data.delta.text;
    }
  }
  /** Observe a non-streaming Messages response. */
  json(body: unknown) {
    if (object(body)) this.take(body.usage);
    this.stopped = true;
  }
}

/** Builds the forwarded request for the native Anthropic provider. */
export function toAnthropic(body: unknown, route: Route, clientHeaders: Headers, key: string) {
  if (!object(body) || !Array.isArray(body.messages) || !body.messages.length)
    invalid("A model and at least one message are required.");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": clientHeaders.get("anthropic-version") ?? "2023-06-01",
  };
  const beta = clientHeaders.get("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;
  return {
    headers,
    body: JSON.stringify({ ...body, model: route.upstreamModel }),
    stream: body.stream === true,
    estimatedInput: estimateTokens(JSON.stringify(body.messages)),
  };
}

/**
 * True when `raw` is Claude Code's auto-mode classifier call on the Kiro route and
 * Settings → autoModeModel names another enabled Kiro model.
 */
export function autoModeTarget(raw: Record<string, any>, s: Settings): boolean {
  const target = s.autoModeModel;
  if (!target || detectAgent(raw) !== "auto-mode") return false;
  // Provider-prefixed models (anthropic/, openrouter/…) are not the Kiro route.
  const prefixed = (m: string) => PROVIDERS.some((p) => m.startsWith(p.prefix));
  if (prefixed(raw.model) || prefixed(target)) return false;
  const id = modelId(target);
  return s.models.map(modelId).includes(id) && modelId(raw.model) !== id;
}
