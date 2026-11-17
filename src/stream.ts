import {
  Completion,
  EventDecoder,
  type Prepared,
  type ToolCall,
} from "./protocol.ts";
import { HttpError } from "./types.ts";
export type ApiMode = "openai" | "anthropic";
const anthropicStop = (r: Completion) =>
  r.stopReason ?? (r.tools.length ? "tool_use" : "end_turn");
const openaiFinish = (r: Completion) =>
  r.stopReason === "max_tokens" ? "length" : r.tools.length ? "tool_calls" : "stop";
export class Formatter {
  mode: ApiMode;
  id: string;
  model: string;
  created = Math.floor(Date.now() / 1000);
  index = 0;
  textOpen = false;
  toolIndex = 0;
  constructor(mode: ApiMode, id: string, model: string) {
    this.mode = mode;
    this.id = id;
    this.model = model;
  }
  private event(type: string, data: unknown) {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  }
  private chunk(delta: unknown, finish: string | null = null) {
    return `data: ${JSON.stringify({ id: this.id, object: "chat.completion.chunk", created: this.created, model: this.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  }
  /** Anthropic clients (e.g. Claude Code) read prompt size from message_start, so send the estimate up front. */
  start(inputTokens = 0) {
    return this.mode === "openai"
      ? this.chunk({ role: "assistant", content: "" })
      : this.event("message_start", {
          type: "message_start",
          message: {
            id: this.id,
            type: "message",
            role: "assistant",
            content: [],
            model: this.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: inputTokens, output_tokens: 0 },
          },
        });
  }
  text(text: string) {
    if (this.mode === "openai") return this.chunk({ content: text });
    let result = "";
    if (!this.textOpen) {
      result += this.event("content_block_start", {
        type: "content_block_start",
        index: this.index,
        content_block: { type: "text", text: "" },
      });
      this.textOpen = true;
    }
    return (
      result +
      this.event("content_block_delta", {
        type: "content_block_delta",
        index: this.index,
        delta: { type: "text_delta", text },
      })
    );
  }
  private closeText() {
    if (!this.textOpen) return "";
    this.textOpen = false;
    return this.event("content_block_stop", {
      type: "content_block_stop",
      index: this.index++,
    });
  }
  tool(tool: ToolCall) {
    if (this.mode === "openai")
      return this.chunk({
        tool_calls: [
          {
            index: this.toolIndex++,
            id: tool.id,
            type: "function",
            function: { name: tool.name, arguments: tool.arguments },
          },
        ],
      });
    return (
      this.closeText() +
      this.event("content_block_start", {
        type: "content_block_start",
        index: this.index,
        content_block: {
          type: "tool_use",
          id: tool.id,
          name: tool.name,
          input: {},
        },
      }) +
      this.event("content_block_delta", {
        type: "content_block_delta",
        index: this.index,
        delta: { type: "input_json_delta", partial_json: tool.arguments },
      }) +
      this.event("content_block_stop", {
        type: "content_block_stop",
        index: this.index++,
      })
    );
  }
  finish(result: Completion, includeUsage: boolean) {
    if (this.mode === "openai")
      return (
        this.chunk({}, openaiFinish(result)) +
        (includeUsage
          ? `data: ${JSON.stringify({ id: this.id, object: "chat.completion.chunk", created: this.created, model: this.model, choices: [], usage: result.usage() })}\n\n`
          : "") +
        "data: [DONE]\n\n"
      );
    return (
      this.closeText() +
      this.event("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: anthropicStop(result),
          stop_sequence: null,
        },
        usage: {
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
        },
      }) +
      this.event("message_stop", { type: "message_stop" })
    );
  }
  error(code: string) {
    return this.mode === "openai"
      ? `data: ${JSON.stringify({ error: { type: "upstream_error", code, message: "Upstream stream failed. Inspect the request ID in the dashboard." } })}\n\n`
      : this.event("error", {
          type: "error",
          error: { type: "api_error", message: code },
        });
  }
  json(result: Completion) {
    if (this.mode === "openai")
      return {
        id: this.id,
        object: "chat.completion",
        created: this.created,
        model: this.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: result.text || null,
              ...(result.tools.length
                ? {
                    tool_calls: result.tools.map((t) => ({
                      id: t.id,
                      type: "function",
                      function: { name: t.name, arguments: t.arguments },
                    })),
                  }
                : {}),
            },
            finish_reason: openaiFinish(result),
          },
        ],
        usage: result.usage(),
      };
    return {
      id: this.id,
      type: "message",
      role: "assistant",
      model: this.model,
      content: [
        ...(result.text ? [{ type: "text", text: result.text }] : []),
        ...result.tools.map((t) => ({
          type: "tool_use",
          id: t.id,
          name: t.name,
          input: JSON.parse(t.arguments),
        })),
      ],
      stop_reason: anthropicStop(result),
      stop_sequence: null,
      usage: {
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
      },
    };
  }
}
export async function consume(
  response: Response,
  prepared: Prepared,
  result: Completion,
  emit?: (event: { text?: string; tool?: ToolCall }) => Promise<void>,
  /** Called for every upstream chunk (keeps the idle timeout alive). */
  onChunk?: () => void,
) {
  if (!response.body)
    throw new HttpError(
      502,
      "empty_upstream",
      "Kiro returned no response body.",
    );
  const reader = response.body.getReader(),
    decoder = new EventDecoder();
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      onChunk?.();
      bytes += value.length;
      if (bytes > 16 * 1024 * 1024)
        throw new HttpError(
          502,
          "output_limit",
          "Upstream output exceeded 16 MiB.",
        );
      for (const event of decoder.feed(value)) {
        const delta = result.accept(event);
        if (emit && (delta.text || delta.tool)) await emit(delta);
      }
    }
    decoder.finish();
    result.validateEnd();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    result.finalize();
  }
}
