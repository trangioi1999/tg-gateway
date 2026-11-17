/** Provider quota lookups. Failures are reduced to short codes; upstream bodies are never surfaced. */
export interface KiroUsage { plan?: string; used: number; limit: number; resetAt?: number }
export type QuotaResult<T> = { ok: true; value: T } | { ok: false; error: string };

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function toMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

export function parseKiroUsage(data: unknown): KiroUsage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, any>;
  const list = Array.isArray(d.usageBreakdownList) ? d.usageBreakdownList : [];
  const item = list.find((i: any) => i?.resourceType === "CREDIT") ?? list[0];
  if (!item || typeof item !== "object") return null;
  const used = num(item.currentUsageWithPrecision) ?? num(item.currentUsage);
  const limit = num(item.usageLimitWithPrecision) ?? num(item.usageLimit);
  if (used === undefined || limit === undefined) return null;
  const out: KiroUsage = { used, limit };
  const plan = d.subscriptionInfo?.subscriptionTitle;
  if (typeof plan === "string") out.plan = plan;
  const resetAt = toMs(d.nextDateReset);
  if (resetAt !== undefined) out.resetAt = resetAt;
  return out;
}

export function parseOpenRouterCredits(data: unknown): { balanceUsd: number } | null {
  const d = (data as any)?.data;
  const total = num(d?.total_credits), used = num(d?.total_usage);
  return total === undefined || used === undefined ? null : { balanceUsd: total - used };
}

async function get<T>(url: string, headers: Record<string, string>, parse: (d: unknown) => T | null): Promise<QuotaResult<T>> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, error: `http_${response.status}` };
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, error: "bad_response" };
    }
    const value = parse(data);
    return value === null ? { ok: false, error: "bad_response" } : { ok: true, value };
  } catch (error) {
    return { ok: false, error: (error as Error)?.name === "TimeoutError" ? "timeout" : "fetch_failed" };
  }
}

export function fetchKiroUsage(token: string, region: string, profileArn: string | undefined, version: string) {
  const query = new URLSearchParams({ origin: "AI_EDITOR", resourceType: "AGENTIC_REQUEST" });
  if (profileArn) query.set("profileArn", profileArn);
  const agent = `aws-sdk-js/1.0.27 KiroIDE-${version}-tg-gateway`;
  return get(`https://q.${region}.amazonaws.com/getUsageLimits?${query}`, {
    Authorization: `Bearer ${token}`, "User-Agent": agent, "x-amz-user-agent": agent,
  }, parseKiroUsage);
}

export function fetchOpenRouterCredits(key: string) {
  return get("https://openrouter.ai/api/v1/credits", { Authorization: `Bearer ${key}` }, parseOpenRouterCredits);
}
