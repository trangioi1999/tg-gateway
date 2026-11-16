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
