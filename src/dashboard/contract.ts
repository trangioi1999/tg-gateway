import type { Settings } from "../types.ts";
export type Period = "day" | "week" | "month";
export type ProviderId = "kiro" | "anthropic" | "openrouter" | "deploy";
export interface Range { period: Period; from: number; to: number; previousFrom: number; previousTo: number }
export interface Totals {
  requests: number; successful: number; failed: number;
  input_tokens: number; output_tokens: number;
  estimated_credits: number; reported_credits: number; reported_requests: number;
  cost_usd: number; saved_tokens: number; cache_hits: number; avg_latency: number;
}
export interface OverviewResponse {
  range: Range; totals: Totals; previous: Totals; month: Totals;
  byProvider: (Totals & { provider: ProviderId })[];
  models: (Totals & { model: string; provider: ProviderId })[];
  clients: (Totals & { client: string })[];
  active: number; settings: Settings; generatedAt: number;
}
export interface RequestRow {
  id: string; started: number; finished: number | null; endpoint: string; model: string;
  provider: ProviderId; client: string; status: number; latency: number;
  input_tokens: number; output_tokens: number; input_source: string; output_source: string;
  estimated_credits: number; reported_credits: number | null; cost_usd: number | null;
  error_code: string | null; error_message: string | null; optimizations: string; saved_tokens: number;
  streamed: number; ip: string | null; country: string | null; city: string | null; colo: string | null;
  user_agent: string | null; upstream_host: string | null; ttfb: number | null;
}
export interface RequestList { page: number; pageSize: number; total: number; items: RequestRow[]; summary: Totals; range: Range }
export type StepKey = "received" | "auth" | "optimize" | "cache" | "local" | "upstream" | "stream" | "done" | "error";
export type StepState = "done" | "skip" | "active" | "error" | "pending";
/** at/dur in ms from request start; null = not reached. */
export interface Step { key: StepKey; state: StepState; at: number | null; dur: number | null; detail: string }
export interface Payload { request: string | null; response: string | null; truncated: boolean }
export interface RequestDetail { request: RequestRow; steps: Step[]; payload: Payload | null }
export interface ProviderQuota {
  id: ProviderId; configured: boolean; ok: boolean; error?: string;
  plan?: string; used?: number; limit?: number; unit: "credit" | "usd";
  resetAt?: number; balanceUsd?: number; monthCostUsd?: number; budgetUsd?: number; fetchedAt: number;
}
export interface ProvidersResponse { providers: ProviderQuota[] }

export interface KiroStatus {
  source: "dashboard" | "secret" | "none";
  type?: "social" | "sso";
  region?: string;
  expiresAt?: string;
}
