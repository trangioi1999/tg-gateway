/**
 * Coarse client detection from request headers, for the dashboard only. Headers are
 * self-reported and trivially spoofed, so this never drives auth or limits.
 */
export const CLIENTS = [
  "claude-code-ide",
  "claude-code",
  "cursor",
  "cline",
  "roo-code",
  "kilo-code",
  "continue",
  "opencode",
  "aider",
  "gemini-cli",
  "openrouter",
  "anthropic-sdk",
  "openai-sdk",
  "curl",
  "other",
] as const;
export type ClientId = (typeof CLIENTS)[number];

const rules: [RegExp, ClientId][] = [
  // Claude Code: "claude-cli/2.1.325 (external, cli|sdk-cli|claude-vscode|...)"
  [/claude-cli\/[^(]*\([^)]*(vscode|jetbrains|ide)/i, "claude-code-ide"],
  [/claude-cli\/|claude-code/i, "claude-code"],
  [/cursor/i, "cursor"],
  [/\broo[- ]?code|roo-cline/i, "roo-code"],
  [/kilo[- ]?code/i, "kilo-code"],
  [/\bcline\b/i, "cline"],
  [/continue/i, "continue"],
  [/opencode/i, "opencode"],
  [/aider|litellm/i, "aider"],
  [/gemini[- ]?cli/i, "gemini-cli"],
  [/openrouter/i, "openrouter"],
  [/anthropic/i, "anthropic-sdk"],
  [/openai/i, "openai-sdk"],
  [/^curl\//i, "curl"],
];

export function detectClient(headers: Headers): ClientId {
  const ua = headers.get("user-agent") ?? "";
  const app = headers.get("x-title") ?? headers.get("http-referer") ?? "";
  const probe = `${ua} ${app}`;
  for (const [pattern, id] of rules) if (pattern.test(probe)) return id;
  // Stainless-generated SDKs send x-stainless-lang even when the UA is generic.
  if (headers.get("x-stainless-lang"))
    return headers.get("anthropic-version") ? "anthropic-sdk" : "openai-sdk";
  return "other";
}

/** Scan only the start of very long system prompts. */
const AGENT_SCAN_CHARS = 200_000;
/** `[agent:coder]` written anywhere in an agent's system prompt (e.g. .claude/agents/coder.md). */
const AGENT_MARKER = /\[agent:\s*([\w.-]{1,40})\s*\]/i;

function systemText(body: Record<string, any>): string {
  const text = (v: unknown): string =>
    typeof v === "string"
      ? v
      : Array.isArray(v)
        ? v.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n")
        : "";
  // Anthropic: top-level `system`; OpenAI: system/developer messages.
  const parts = [text(body.system)];
  if (Array.isArray(body.messages))
    for (const m of body.messages)
      if (m?.role === "system" || m?.role === "developer") parts.push(text(m.content));
  return parts.join("\n").slice(0, AGENT_SCAN_CHARS);
}

/**
 * Which agent sent the request, for the dashboard: an explicit `[agent:name]` marker, or a
 * coarse guess from Claude Code's own prompts ("main" session, "background" side call, built-in "subagent",
 * "auto-mode" safety classifier). Null when nothing matches. Display only, like detectClient.
 */
export function detectAgent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const system = systemText(body as Record<string, any>);
  if (!system) return null;
  const marker = AGENT_MARKER.exec(system);
  if (marker) return marker[1].toLowerCase();
  if (system.includes("You are a security monitor for autonomous AI coding agents")) return "auto-mode";
  // The main session always sends its tools; Claude Code's small side calls (session
  // title, topic check) carry the same prompt opening but no tools.
  if (/You are Claude Code, Anthropic's official CLI/.test(system)) {
    const tools = (body as Record<string, any>).tools;
    return Array.isArray(tools) && tools.length ? "main" : "background";
  }
  if (/Claude Code|Anthropic's official CLI for Claude/.test(system)) return "subagent";
  return null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** "…_session_<uuid>" (older) or {"session_id":"<uuid>"} (JSON string) in metadata.user_id. */
const SESSION_IN_USER_ID = new RegExp(`session(?:_id)?["']?\\s*[:_=]\\s*["']?(${UUID})`, "i");
const SESSION_HEADER = new RegExp(`^${UUID}$`, "i");

/**
 * Claude Code session that sent the request (the name of its local transcript file,
 * ~/.claude/projects/<project>/<session>.jsonl), from the x-claude-code-session-id header or
 * metadata.user_id. Null for other clients. Display and grouping only.
 */
export function detectSession(headers: Headers, body: unknown): string | null {
  const header = headers.get("x-claude-code-session-id")?.trim();
  if (header && SESSION_HEADER.test(header)) return header.toLowerCase();
  const userId = (body as Record<string, any> | null)?.metadata?.user_id;
  if (typeof userId !== "string") return null;
  return SESSION_IN_USER_ID.exec(userId)?.[1].toLowerCase() ?? null;
}
