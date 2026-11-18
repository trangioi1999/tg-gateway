export interface Env {
  GATEWAY: DurableObjectNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
  GATEWAY_API_KEY?: string;
  SESSION_SECRET?: string;
  VAULT_KEY?: string;
  KIRO_CREDENTIALS?: string;
  OPENROUTER_API_KEY?: string;
  DEPLOY_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}
export interface Settings {
  enabled: boolean;
  apiRegion: string;
  /** Kiro IDE version reported upstream; Kiro rejects versions it no longer supports. */
  kiroVersion: string;
  models: string[];
  inputCreditsPerMillion: number;
  outputCreditsPerMillion: number;
  monthlyCreditBudget: number;
  requestsPerMinute: number;
  retentionDays: number;
  /** Idle timeout: abort when the upstream sends nothing for this long. */
  timeoutSeconds: number;
  /** Replace old tool results with a placeholder once the prompt is large (Kiro only). */
  clearToolResults: boolean;
  clearTriggerTokens: number;
  clearKeepToolUses: number;
  /** Also shorten long strings inside old tool call arguments. */
  clearToolInputs: boolean;
  /** Summarize the start of long conversations with a cheap model (stores summaries). */
  compactEnabled: boolean;
  compactTriggerTokens: number;
  compactKeepTokens: number;
  compactModel: string;
  /**
   * Kiro model for Claude Code's auto-mode safety classifier (one extra request per tool
   * call, sent with the main model). "" = keep the client's model. Applies only when the
   * model is enabled in `models`.
   */
  autoModeModel: string;
  /**
   * Experimental: reuse one Kiro conversationId per conversation thread instead of a new
   * one per request, to measure whether Kiro charges less. Off by default.
   */
  stableConversationId: boolean;
  /**
   * Kiro route: send only these tool definitions (names, `*` wildcard); empty = all.
   * Claude Code's built-in tools alone are ~25k tokens on every request.
   */
  toolAllowlist: string[];
  /** Kiro route: never send these tool definitions (names, `*` wildcard). */
  toolDenylist: string[];
  /** Replay identical completed requests from memory for this long (0 = off). */
  responseCacheSeconds: number;
  /** Name shown in the console header. */
  displayName: string;
  /** Store request/response payloads for debugging: never, only failed requests, or all. */
  capturePayloads: "off" | "errors" | "all";
  payloadRetentionDays: number;
  /** Monthly Anthropic spend budget in USD (0 = none). */
  anthropicMonthlyBudgetUsd: number;
}
export const defaults: Settings = {
  enabled: true,
  apiRegion: "us-east-1",
  kiroVersion: "1.4.178",
  models: ["claude-sonnet-4.5", "claude-haiku-4.5"],
  inputCreditsPerMillion: 0,
  outputCreditsPerMillion: 0,
  monthlyCreditBudget: 0,
  requestsPerMinute: 30,
  retentionDays: 90,
  timeoutSeconds: 180,
  clearToolResults: true,
  clearTriggerTokens: 60_000,
  clearKeepToolUses: 4,
  clearToolInputs: false,
  compactEnabled: false,
  compactTriggerTokens: 120_000,
  compactKeepTokens: 30_000,
  compactModel: "claude-haiku-4.5",
  autoModeModel: "claude-sonnet-5.5",
  stableConversationId: false,
  toolAllowlist: [],
  toolDenylist: [],
  responseCacheSeconds: 300,
  displayName: "Admin",
  capturePayloads: "off",
  payloadRetentionDays: 3,
  anthropicMonthlyBudgetUsd: 0,
};
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function validateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new HttpError(400, "invalid_settings", "Settings must be an object.");
  const s = raw as Settings;
  if (Object.keys(s).some((k) => !Object.hasOwn(defaults, k)))
    throw new HttpError(400, "invalid_settings", "Unknown setting.");
  if (
    typeof s.enabled !== "boolean" ||
    typeof s.apiRegion !== "string" ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(s.apiRegion)
  )
    throw new HttpError(
      400,
      "invalid_settings",
      "Invalid region or gateway state.",
    );
  if (typeof s.kiroVersion !== "string" || !/^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(s.kiroVersion))
    throw new HttpError(400, "invalid_settings", "Kiro version must look like 1.4.178.");
  if (
    !Array.isArray(s.models) ||
    !s.models.length ||
    s.models.length > 40 ||
    s.models.some(
      // "/" allows provider-prefixed IDs such as openrouter/deepseek/deepseek-chat.
      (m) => typeof m !== "string" || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(m),
    )
  )
    throw new HttpError(
      400,
      "invalid_settings",
      "Provide 1–40 valid model IDs.",
    );
  for (const key of [
    "inputCreditsPerMillion",
    "outputCreditsPerMillion",
    "monthlyCreditBudget",
  ] as const)
    if (
      typeof s[key] !== "number" ||
      !Number.isFinite(s[key]) ||
      s[key] < 0 ||
      s[key] > 1e9
    )
      throw new HttpError(400, "invalid_settings", `Invalid ${key}.`);
  for (const [key, min, max] of [
    ["requestsPerMinute", 1, 1000],
    ["retentionDays", 1, 365],
    ["timeoutSeconds", 10, 600],
    ["clearTriggerTokens", 1000, 2_000_000],
    ["clearKeepToolUses", 0, 100],
    ["compactTriggerTokens", 10_000, 2_000_000],
    ["compactKeepTokens", 1000, 1_000_000],
    ["responseCacheSeconds", 0, 3600],
    ["payloadRetentionDays", 1, 30],
  ] as const)
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max)
      throw new HttpError(400, "invalid_settings", `Invalid ${key}.`);
  if (
    typeof s.displayName !== "string" ||
    s.displayName.trim().length < 1 ||
    s.displayName.trim().length > 40 ||
    /[\u0000-\u001f\u007f]/.test(s.displayName)
  )
    throw new HttpError(400, "invalid_settings", "displayName must be 1–40 characters without control characters.");
  if (!["off", "errors", "all"].includes(s.capturePayloads))
    throw new HttpError(400, "invalid_settings", "capturePayloads must be off, errors or all.");
  if (
    typeof s.anthropicMonthlyBudgetUsd !== "number" ||
    !Number.isFinite(s.anthropicMonthlyBudgetUsd) ||
    s.anthropicMonthlyBudgetUsd < 0 ||
    s.anthropicMonthlyBudgetUsd > 1e6
  )
    throw new HttpError(400, "invalid_settings", "Invalid anthropicMonthlyBudgetUsd.");
  for (const key of ["clearToolResults", "clearToolInputs", "compactEnabled", "stableConversationId"] as const)
    if (typeof s[key] !== "boolean")
      throw new HttpError(400, "invalid_settings", `Invalid ${key}.`);
  if (s.compactKeepTokens >= s.compactTriggerTokens)
    throw new HttpError(400, "invalid_settings", "compactKeepTokens must be below compactTriggerTokens.");
  if (
    typeof s.compactModel !== "string" ||
    !/^[a-zA-Z0-9._:-]{1,160}$/.test(s.compactModel)
  )
    throw new HttpError(400, "invalid_settings", "compactModel must be a Kiro model ID (no provider prefix).");
  if (typeof s.autoModeModel !== "string" || !/^[a-zA-Z0-9._:-]{0,160}$/.test(s.autoModeModel))
    throw new HttpError(400, "invalid_settings", "autoModeModel must be empty or a Kiro model ID (no provider prefix).");
  const toolList = (key: "toolAllowlist" | "toolDenylist") => {
    const list = s[key];
    if (
      !Array.isArray(list) ||
      list.length > 200 ||
      list.some((t) => typeof t !== "string" || (t.trim() !== "" && !/^[\w.:*/-]{1,256}$/.test(t.trim())))
    )
      throw new HttpError(400, "invalid_settings", `${key}: up to 200 tool names (letters, digits, _ . : - / and * as wildcard).`);
    return [...new Set(list.map((t) => t.trim()).filter(Boolean))];
  };
  return { ...s, models: [...new Set(s.models)], toolAllowlist: toolList("toolAllowlist"), toolDenylist: toolList("toolDenylist") };
}
