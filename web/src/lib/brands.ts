const clients: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-code-ide": "Claude Code (IDE)",
  continue: "Continue",
  aider: "Aider",
  openrouter: "OpenRouter",
  "anthropic-sdk": "Anthropic SDK",
  "openai-sdk": "OpenAI SDK",
  curl: "curl",
  other: "Khác",
  "tg-gateway": "Gateway (compact)",
  cursor: "Cursor",
  cline: "Cline",
  "roo-code": "Roo Code",
  "kilo-code": "Kilo Code",
  "gemini-cli": "Gemini CLI",
  opencode: "OpenCode",
  openai: "OpenAI",
  claude: "Claude",
  deepseek: "DeepSeek",
  qwen: "Qwen",
};
export const clientLabel = (id: string) => clients[id] ?? id;
export const providerLabel = (id: string) =>
  ({
    kiro: "Kiro",
    anthropic: "Claude API",
    openrouter: "OpenRouter",
    deploy: "Deploy",
  })[id] ?? id;
export const brandIds = [
  "kiro",
  "claude",
  "claude-code",
  "gemini-cli",
  "deepseek",
  "qwen",
  "anthropic",
  "cline",
  "cursor",
  "kilo-code",
  "openai",
  "opencode",
  "openrouter",
  "roo-code",
  "gemini",
];
/** Client ids that reuse another brand's logo. */
const brandAliases: Record<string, string> = {
  "claude-code-ide": "claude-code",
  "anthropic-sdk": "anthropic",
  "openai-sdk": "openai",
};
/** Logo id for a client/provider id, or null when no logo exists. */
export const brandOf = (id: string): string | null => {
  const b = brandAliases[id] ?? id;
  return brandIds.includes(b) ? b : null;
};
export const colorBrands = [
  "kiro",
  "claude",
  "claude-code",
  "gemini-cli",
  "deepseek",
  "qwen",
];
