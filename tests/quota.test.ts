import test from "node:test";
import assert from "node:assert/strict";
import { parseKiroUsage, parseOpenRouterCredits } from "../src/upstream/quota.ts";

test("parseKiroUsage reads the credit item", () => {
  assert.deepEqual(
    parseKiroUsage({
      subscriptionInfo: { subscriptionTitle: "KIRO PRO" },
      nextDateReset: 1764547200,
      usageBreakdownList: [{ resourceType: "CREDIT", currentUsageWithPrecision: 235.4, usageLimitWithPrecision: 2000 }],
    }),
    { plan: "KIRO PRO", used: 235.4, limit: 2000, resetAt: 1764547200000 },
  );
  assert.equal(parseKiroUsage({}), null);
});

test("parseKiroUsage fallbacks and reset formats", () => {
  const r = parseKiroUsage({
    nextDateReset: 1764547200000,
    usageBreakdownList: [{ resourceType: "OTHER", currentUsage: 1, usageLimit: 5 }, { resourceType: "CREDIT", currentUsage: 3, usageLimit: 9 }],
  });
  assert.deepEqual(r, { used: 3, limit: 9, resetAt: 1764547200000 });
  assert.equal(parseKiroUsage({ nextDateReset: "2025-12-01T00:00:00Z", usageBreakdownList: [{ currentUsage: 1, usageLimit: 2 }] })?.resetAt, Date.parse("2025-12-01T00:00:00Z"));
});

test("parseOpenRouterCredits", () => {
  const r = parseOpenRouterCredits({ data: { total_credits: 30, total_usage: 11.4 } });
  assert.ok(r && Math.abs(r.balanceUsd - 18.6) < 1e-9);
  assert.equal(parseOpenRouterCredits({ error: {} }), null);
});

import { safeEntry } from "../src/dashboard/api.ts";
import { HttpError } from "../src/types.ts";

test("safeEntry turns a throw into an ok:false entry", async () => {
  const a = await safeEntry("anthropic", "usd", () => { throw new Error("db"); });
  assert.deepEqual([a.id, a.ok, a.error, a.unit], ["anthropic", false, "fetch_failed", "usd"]);
  const k = await safeEntry("kiro", "credit", async () => { throw new HttpError(503, "credentials_invalid", "x"); });
  assert.equal(k.error, "credentials_invalid");
});

import { cacheable } from "../src/dashboard/api.ts";

test("cacheable: not_configured is healthy, other failures are not", () => {
  const e = (ok: boolean, error?: string) => ({ id: "kiro" as const, configured: true, ok, error, unit: "usd" as const, fetchedAt: 0 });
  assert.equal(cacheable([e(true), e(false, "not_configured")]), true);
  assert.equal(cacheable([e(true), e(false, "timeout")]), false);
  assert.equal(cacheable([e(false, "http_503")]), false);
});
