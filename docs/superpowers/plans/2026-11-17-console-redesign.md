# Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vanilla-JS dashboard with a React console matching the approved mockup, backed by durable hourly stats, per-request traces/payloads, and real provider quotas.

**Architecture:** Worker code stays in `src/` but `index.ts` is split by responsibility; new pure modules (`period`, `trace`, `quota` parsers) carry unit tests, SQL behaviour is covered by the Miniflare integration test. The frontend is a Vite + React + TS app in `web/` built to `web/dist`, served by the `ASSETS` binding. One shared types file (`src/dashboard/contract.ts`) is the API contract both sides import.

**Tech Stack:** Cloudflare Workers + Durable Object SQLite, TypeScript 5.9, node:test, Miniflare 5, React 18.3.1, Vite 5.4.11, @vitejs/plugin-react 4.3.4, @fontsource/be-vietnam-pro, @fontsource/jetbrains-mono.

**Spec:** `docs/superpowers/specs/2026-11-17-console-redesign-design.md` · **Visual source of truth:** `docs/mockups/console-redesign.html` (copy its CSS tokens, class structure and copy text; drop the mockup-only top bar `.mbar` and sample data).

## Global Constraints

- `/v1/*` proxy behaviour must not change; every existing test in `tests/` keeps passing.
- CSP stays exactly as in `src/index.ts` (`script-src 'self'; style-src 'self'`, default `'self'`): no inline scripts/styles in built HTML, no Google Fonts, Vite `build.assetsInlineLimit: 0`.
- Database stays Durable Object SQLite. No new storage services.
- UI copy is Vietnamese, Apple style, light + dark + system theme, font Be Vietnam Pro (headings 700, labels 600), mono JetBrains Mono.
- Payload capture defaults to `"off"`; captured request/response text is cut at 65 536 bytes each.
- `stats_hourly` rows are never deleted by history clearing or retention.
- Exact versions: react/react-dom `18.3.1`, `@types/react` `18.3.12`, `@types/react-dom` `18.3.1`, vite `5.4.11`, `@vitejs/plugin-react` `4.3.4`, `@fontsource/be-vietnam-pro` `5.1.0`, `@fontsource/jetbrains-mono` `5.1.1`.
- Commit after each task on branch `feat/console-redesign`, message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Clearing history (`DELETE /api/requests`, with or without `before`) while a request is in flight: the in-flight row and its later stats upsert must survive → integration test in Task 3.
2. Upgrading an existing database (old `requests` rows, no `stats_hourly`): backfill runs once and overview totals equal the old totals → integration test in Task 3.
3. Viewer in UTC+7 asking for "today": the range must start at local midnight, not UTC midnight → unit test in Task 2.
4. Capture mode `errors` with a successful streamed request: nothing is written to `payloads`; with a failing one, request and error body are written → integration test in Task 4.
5. Kiro `getUsageLimits` returning an unexpected shape or HTTP error: `/api/providers` still answers 200 with `ok:false` for Kiro and the other providers intact → unit + integration test in Task 5.

## API contract (`src/dashboard/contract.ts`, created in Task 2, types only)

```ts
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
```

Query params (all dashboard list/aggregate routes): `period=day|week|month`, `anchor=YYYY-MM-DD` (viewer-local date), `tz=<minutes east of UTC>` (frontend sends `-new Date().getTimezoneOffset()`).

---

### Task 1: Split `src/index.ts` without behaviour change

**Files:**
- Create: `src/gateway.ts` (class `Gateway`: constructor, `settings`, `limit`, `alarm`, `fetch`, `cookie`, `isAdmin`, `chat`, `compact`, `summarize`, `kiro`), `src/db/schema.ts`, `src/upstream/kiro.ts`, `src/dashboard/api.ts`
- Modify: `src/index.ts` (keeps only the default export Worker handler + `export { Gateway } from "./gateway.ts"`)

**Interfaces:**
- Produces: `migrate(sql: SqlStorage): void` in `src/db/schema.ts` (all `CREATE TABLE`/`ALTER TABLE` currently in the constructor); `kiroFetch(payload: object, s: Settings, token: string, instance: string, signal: AbortSignal): Promise<Response>`, `kiroError(response: Response, region: string): Promise<HttpError>` in `src/upstream/kiro.ts`; `json(data, status?, headers?)`, `failure(error, id?, mode?, billed?)` exported from `src/dashboard/api.ts` together with `overview(gw, url)`, `requests(gw, url)`, `exportCsv(gw, url)` taking the `Gateway` instance.

- [ ] **Step 1:** Move code as listed; `Gateway.kiro()` keeps the retry-on-401/403 logic and calls `kiroFetch`. No logic edits.
- [ ] **Step 2:** Run `npm run check && npm test && npm run test:integration` — expect all PASS (same counts as before the move).
- [ ] **Step 3:** Commit `refactor: split worker entry into gateway, schema, kiro upstream and dashboard api`.

### Task 2: Contract, new settings, period ranges

**Files:**
- Create: `src/dashboard/contract.ts` (exact text above), `src/dashboard/period.ts`, `tests/period.test.ts`
- Modify: `src/types.ts` (Settings + defaults + validateSettings)

**Interfaces:**
- Produces: `periodRange(period: Period, anchor: string, tzMinutes: number): Range`; `parsePeriod(url: URL, now?: number): Range` (defaults: `week`, today in `tz`, `tz=0`; throws `HttpError(400,"invalid_range")` on bad values; `tz` must be an integer in [-840, 840]).
- Produces settings: `displayName: string` (default `"Admin"`, 1–40 chars, no control characters), `capturePayloads: "off" | "errors" | "all"` (default `"off"`), `payloadRetentionDays: number` (int 1–30, default 3), `anthropicMonthlyBudgetUsd: number` (0–1e6, default 0).

- [ ] **Step 1: Write failing tests in `tests/period.test.ts`**

```ts
const H = 3600_000, D = 24 * H;
test("day in UTC+7 starts at local midnight", () => {
  const r = periodRange("day", "2026-11-17", 420);
  assert.equal(r.from, Date.UTC(2026, 10, 17) - 7 * H);
  assert.equal(r.to, r.from + D);
  assert.equal(r.previousTo, r.from);
  assert.equal(r.previousFrom, r.from - D);
});
test("week starts on Monday", () => {
  const r = periodRange("week", "2026-11-19", 0); // Thursday
  assert.equal(r.from, Date.UTC(2026, 10, 16));
  assert.equal(r.to, Date.UTC(2026, 10, 23));
  assert.equal(r.previousFrom, Date.UTC(2026, 10, 9));
});
test("month uses calendar months; previous month has its own length", () => {
  const r = periodRange("month", "2026-03-10", 0);
  assert.equal(r.from, Date.UTC(2026, 2, 1));
  assert.equal(r.to, Date.UTC(2026, 3, 1));
  assert.equal(r.previousFrom, Date.UTC(2026, 1, 1));
  assert.equal(r.previousTo, Date.UTC(2026, 2, 1));
});
test("parsePeriod rejects bad input", () => {
  assert.throws(() => parsePeriod(new URL("https://x/?period=year")), /invalid_range|period/);
  assert.throws(() => parsePeriod(new URL("https://x/?anchor=2026-13-01")));
  assert.throws(() => parsePeriod(new URL("https://x/?tz=9999")));
});
```
Add to an existing settings test (`tests/auth.test.ts` or new `tests/settings.test.ts`): `validateSettings({...defaults, capturePayloads: "sometimes"})` throws; `validateSettings({...defaults, displayName: ""})` throws; defaults validate.

- [ ] **Step 2:** `npm test` → FAIL (module not found).
- [ ] **Step 3:** Implement `periodRange`/`parsePeriod` and the settings fields.
- [ ] **Step 4:** `npm run check && npm test` → PASS.
- [ ] **Step 5:** Commit `feat: period ranges, dashboard contract and new settings`.

### Task 3: Durable hourly stats + overview by period

**Files:**
- Create: `src/db/stats.ts`
- Modify: `src/db/schema.ts`, `src/gateway.ts` (`finish()` in `chat`, `finally` in `summarize`, DELETE route, alarm), `src/dashboard/api.ts` (`overview`, `requests` summary/range), `tests/integration.mjs`

**Interfaces:**
- Consumes: `Range`, `Totals`, `OverviewResponse` (Task 2).
- Produces in `src/db/stats.ts`:
  - `recordStats(sql: SqlStorage, r: { started: number; provider: string; client: string; model: string; status: number; latency: number; input_tokens: number; output_tokens: number; estimated_credits: number; reported_credits: number | null; cost_usd: number | null; saved_tokens: number; cache_hit: boolean }): void` — single `INSERT … ON CONFLICT(hour,provider,client,model) DO UPDATE SET col=col+excluded.col`; `successful` = 200–299, `failed` = ≥400; `latency_sum/count` only when status ≠ 0.
  - `backfillStats(sql: SqlStorage): void` — inserts aggregates of `requests WHERE status<>0`.
  - `totals(sql, from: number, to: number, provider?: string): Totals` and `grouped(sql, from, to, by: "provider" | "model" | "client", provider?: string): (Totals & Record<string, string>)[]` — hour filter `hour >= floor(from/3600000) AND hour < ceil(to/3600000)`; `avg_latency = latency_sum/latency_count` (0 when none); `reported_credits` 0 when null.
- Schema: table `stats_hourly` as in the spec (columns listed there); `PRAGMA user_version` 0→1 creates it and runs `backfillStats` once.
- Routes: `GET /api/overview?period&anchor&tz&provider` → `OverviewResponse` (`month` = calendar month containing `range.from`, same provider filter; `active` = `COUNT(*) FROM requests WHERE status=0`). `DELETE /api/requests?before=<ms>` deletes finished rows with `started < before` (all finished rows when absent) and their `payloads` rows; returns `{ deleted }`. `GET /api/requests` gains `summary: Totals` and `range` from the same period params, replacing `days`.

- [ ] **Step 1: Extend `tests/integration.mjs`** (existing main test, after the current DELETE assertion):

```js
const ov = await (await send("/api/overview?period=day&tz=0")).json();
assert.ok(ov.totals.requests > 0, "stats survive history clearing");
assert.equal(ov.totals.requests, totalsBeforeClear.requests);
assert.ok(Array.isArray(ov.byProvider) && ov.byProvider.some((p) => p.provider === "kiro"));
assert.equal(typeof ov.previous.requests, "number");
```
(`totalsBeforeClear` = `/api/overview?period=day&tz=0` totals fetched right before the DELETE.) Add a test: start a slow streamed request, call `DELETE /api/requests`, finish the stream, then assert the row still exists with status 200 and overview `requests` increased by 1. Backfill/no double count: before any DELETE, assert overview `totals.requests` (period=day) equals `/api/requests?period=day` `total` minus in-flight rows.
- [ ] **Step 2:** `npm run test:integration` → FAIL.
- [ ] **Step 3:** Implement stats module, migration, calls in `finish()`/`summarize`, routes. `cache_hit` = optimizations include `cache_hit`.
- [ ] **Step 4:** `npm run check && npm test && npm run test:integration` → PASS.
- [ ] **Step 5:** Commit `feat: durable hourly stats; clearing history keeps totals`.

### Task 4: Request trace, source info, payload capture, detail route

**Files:**
- Create: `src/trace.ts`, `tests/trace.test.ts`
- Modify: `src/db/schema.ts` (new `requests` columns `ip, country, city, colo, user_agent, error_message, upstream_host, ttfb, steps`; table `payloads(id TEXT PRIMARY KEY, created INTEGER NOT NULL, request TEXT, response TEXT, truncated INTEGER NOT NULL DEFAULT 0)`), `src/gateway.ts`, `src/dashboard/api.ts`, `tests/integration.mjs`

**Interfaces:**
- Produces in `src/trace.ts`:
  - `class Trace { constructor(start?: number, clock?: () => number); mark(key: StepKey, state: StepState, detail?: string, dur?: number | null): void; begin(key: StepKey, detail?: string): (state?: StepState, detail?: string) => void; steps(): Step[] }` — `at` = ms since `start`; `begin` returns a closer that sets `dur`; an unclosed `begin` reports `state:"active"` with `dur` = now − at.
  - `class Capture { constructor(limit?: number /* 65536 */); setRequest(text: string): void; append(text: string): void; result(): Payload }` — byte-accurate cut via `TextEncoder`, `truncated` true if either side was cut.
- Gateway: `traces: Map<string, Trace>` for in-flight requests (deleted in `finish`). In `chat()` record: `received` (detail `"<client> · <ip>"`), `auth` (after rate limit), `optimize` (`done` with detail like `"cleared:3 · compact"` or `skip` with `"below_threshold"` / `"not_kiro"`), `cache` / `local` replays, `upstream` (begin before fetch, detail = host; closed when headers arrive → also stored as `ttfb`), `stream` (begin after headers, closed at end), then `done` or `error` (detail = error code). Store `steps` JSON, `error_message` (HttpError message), `upstream_host`, `ttfb` in `finish()`; store `ip` (`CF-Connecting-IP`), `country/city/colo` (`request.cf`), `user_agent` (≤300 chars) at insert.
- Capture: when `capturePayloads !== "off"`, `setRequest(raw text)`; every chunk written to the client also goes to `append`; write row in `finish()` if mode `all`, or mode `errors` and status ≥ 400. Turning capture off via `PUT /api/settings` runs `DELETE FROM payloads`. Alarm deletes payloads older than `payloadRetentionDays`.
- Routes: `GET /api/requests/:id` → `RequestDetail` (steps from live `Trace` when in flight, else stored JSON; 404 `not_found` if unknown). `GET /api/requests` filters: `provider`, `status`, `q` (LIKE on client, model, ip, error_code; escape `%`/`_`).

- [ ] **Step 1: Failing unit tests `tests/trace.test.ts`**

```ts
test("trace orders steps and measures begin/end", () => {
  let now = 1000; const t = new Trace(now, () => now);
  t.mark("received", "done");
  now = 1005; const end = t.begin("upstream", "q.x"); now = 1100; end();
  const open = t.begin("stream"); now = 1300;
  assert.deepEqual(t.steps(), [
    { key: "received", state: "done", at: 0, dur: null, detail: "" },
    { key: "upstream", state: "done", at: 5, dur: 95, detail: "q.x" },
    { key: "stream", state: "active", at: 100, dur: 200, detail: "" },
  ]);
});
test("capture cuts at the byte limit and flags truncation", () => {
  const c = new Capture(8); c.setRequest("abcdefghij"); c.append("xy");
  assert.deepEqual(c.result(), { request: "abcdefgh", response: "xy", truncated: true });
});
test("capture never splits a multi-byte character", () => {
  const c = new Capture(4); c.setRequest("ảảả"); // 3 bytes each
  assert.equal(c.result().request, "ả");
});
```
- [ ] **Step 2: Integration additions:** after a successful chat, `GET /api/requests/:id` returns steps whose keys include `received`, `upstream`, `done` and `request.user_agent` set; with `capturePayloads:"errors"`, the existing `rate-limit` chat writes a payload (`detail.payload.request` contains `"rate-limit"`) while a successful chat returns `payload: null`; unknown id → 404.
- [ ] **Step 3:** Run tests → FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** `npm run check && npm test && npm run test:integration` → PASS.
- [ ] **Step 6:** Commit `feat: request traces, source info and optional payload capture`.

### Task 5: Provider quotas

**Files:**
- Create: `src/upstream/quota.ts`, `tests/quota.test.ts`
- Modify: `src/gateway.ts` (route + 5-minute cache), `src/kiro-auth.ts` (expose nothing new; reuse `get()` and `profileArn()`), `tests/integration.mjs` (fake upstream handlers)

**Interfaces:**
- Produces: `parseKiroUsage(data: unknown): { plan?: string; used: number; limit: number; resetAt?: number } | null` — reads `usageBreakdownList[]` item whose `resourceType` is `"CREDIT"` (else first item), preferring `currentUsageWithPrecision`/`usageLimitWithPrecision` over `currentUsage`/`usageLimit`; `nextDateReset` (seconds or ms or ISO) → ms; `subscriptionInfo.subscriptionTitle` → `plan`. `parseOpenRouterCredits(data: unknown): { balanceUsd: number } | null` from `data.total_credits - data.total_usage`. `fetchKiroUsage(token: string, region: string, profileArn: string | undefined, version: string): Promise<…>` (GET `https://q.<region>.amazonaws.com/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST[&profileArn=…]`, 15 s timeout) and `fetchOpenRouterCredits(key: string)` (GET `https://openrouter.ai/api/v1/credits`).
- Route `GET /api/providers[?refresh=1]` → `ProvidersResponse` with one entry per provider in order kiro, anthropic, openrouter, deploy. Kiro `configured` = credentials status source ≠ `none`; anthropic/openrouter/deploy `configured` = key env set. Anthropic and deploy: `unit:"usd"`, `monthCostUsd` from `totals(month).cost_usd` filtered by provider, `budgetUsd` = `anthropicMonthlyBudgetUsd` for anthropic. Any fetch/parse failure → that entry `ok:false, error:<short code>`; route itself always 200.

- [ ] **Step 1: Failing unit tests** — `parseKiroUsage({ subscriptionInfo:{subscriptionTitle:"KIRO PRO"}, nextDateReset: 1764547200, usageBreakdownList:[{resourceType:"CREDIT", currentUsageWithPrecision:235.4, usageLimitWithPrecision:2000}] })` → `{ plan:"KIRO PRO", used:235.4, limit:2000, resetAt:1764547200000 }`; `parseKiroUsage({})` → `null`; `parseOpenRouterCredits({data:{total_credits:30,total_usage:11.4}})` → `{balanceUsd:18.6}` (compare with 1e-9 tolerance); `parseOpenRouterCredits({error:{}})` → `null`.
- [ ] **Step 2: Integration:** in the fake upstream add, before other handlers, `GET q.us-east-1.amazonaws.com/getUsageLimits` → the JSON above and `GET openrouter.ai/api/v1/credits` → `{data:{total_credits:30,total_usage:11.4}}`; assert `/api/providers` kiro `{ok:true, used:235.4, limit:2000}`, openrouter `balanceUsd≈18.6`. Second instance whose fake upstream returns 500 for getUsageLimits → kiro `ok:false`, response status 200.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** `npm run check && npm test && npm run test:integration` → PASS.
- [ ] **Step 6:** Commit `feat: provider quotas (Kiro credits, OpenRouter balance, Claude API cost)`.

### Task 6: React app scaffold, shell, login

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/router.ts`, `web/src/theme.ts`, `web/src/api/client.ts`, `web/src/lib/format.ts`, `web/src/lib/brands.ts`, `web/src/styles/{tokens.css,base.css,components.css}`, `web/src/components/{Sidebar.tsx,Seg.tsx,Brand.tsx,Logo.tsx}`, `web/src/pages/Login.tsx`, `web/src/pages/FlowDiagram.tsx`, `tests/web-lib.test.ts`
- Move: `public/icon.svg`, `public/brands/` → `web/public/`
- Modify: `package.json` (deps + scripts), `wrangler.jsonc` (`assets.directory: "./web/dist"`), `.gitignore` (`web/dist/`), `tsconfig.json` (exclude `web`), `src/index.ts` (app-shell regex adds `login`), `tests/integration.mjs` (`GET /` and `/overview` return HTML containing `<div id="root">`), `.github/workflows/ci.yml` unchanged (scripts cover it)

**Interfaces:**
- Consumes: contract types via `import type { … } from "../../src/dashboard/contract.ts"` (web tsconfig `include` adds `../src/dashboard/contract.ts`, `../src/types.ts`).
- Produces: `api<T>(path: string, init?: RequestInit): Promise<T>` (throws `ApiError {status, code, message}`; 401 → router goes to `/login`); `useRoute(): { path: "/login"|"/overview"|"/requests"|"/settings"; go(path): void }`; `useTheme(): ["light"|"dark"|"auto", set]` (sets `data-theme` on `<html>`, persists `tg-theme`); `<Brand id={clientOrProvider} size?>` (colour SVG via `<img>` for `kiro, claude, claude-code, gemini-cli, deepseek, qwen`, otherwise CSS-mask `<i class="mono">` so it follows `currentColor`); format helpers `fmtInt(n)`, `fmtCompact(n)` ("48,2M"), `fmtMs(ms)` ("894 ms" / "1,9 s"), `fmtClock(ms)` ("14:31:58"), `fmtDelta(cur, prev)` ("+18%"), `clientLabel(id)`, `providerLabel(id)`.
- Scripts: `"build:web": "vite build --config web/vite.config.ts"`, `"build": "npm run build:web && wrangler deploy --dry-run --outdir dist"`, `"deploy": "npm run build:web && wrangler deploy"`, `"dev:web": "vite --config web/vite.config.ts"` (proxy `/api`,`/v1`,`/health` → `http://127.0.0.1:8787`), `"check": "tsc --noEmit && tsc --noEmit -p web"`, `"test"` also runs `tests/web-lib.test.ts` (already matched by `tests/*.test.ts`).
- Login: exactly the mockup's left column (logo, `Chào mừng đến <nowrap>TG Gateway</nowrap>`, password field with show/hide, red error `Mật khẩu chưa đúng.` on 401, `Quá nhiều lần thử. Thử lại sau 1 phút.` on 429, button `Tiếp tục`, footer `© {year} TG Gateway · By Trần Giỏi`) and right panel `FlowDiagram` (port of the mockup's `flow()` to JSX: 5 agents with brand logos, Gateway, Tiết kiệm, Định tuyến, Thống kê, 3 providers, request dots blue forward, response dots green reverse, legend, hidden under 960 px, dots hidden with `prefers-reduced-motion`). On success `go("/overview")`. App boot: `GET /api/session` → 200 shows app, else login.

- [ ] **Step 1: Failing tests `tests/web-lib.test.ts`:** `fmtCompact(48_200_000) === "48,2M"`, `fmtMs(894) === "894 ms"`, `fmtMs(1904) === "1,9 s"`, `fmtDelta(118, 100) === "+18%"`, `fmtDelta(94, 100) === "−6%"`, `fmtDelta(5, 0) === "—"`, `clientLabel("roo-code") === "Roo Code"`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement scaffold, move assets, shell (Sidebar with Workspace links + provider list placeholder fed later), Login, FlowDiagram. **Step 4:** `npm install && npm run check && npm test && npm run test:integration` → PASS; `npm run build:web` emits `web/dist/index.html` with only external `<script type="module" src>` / `<link rel="stylesheet">`.
- [ ] **Step 5:** Commit `feat(web): React scaffold, app shell and login with flow diagram`.

### Task 7: Overview page

**Files:** Create `web/src/pages/Overview.tsx`, `web/src/components/{PeriodBar.tsx,ProviderTabs.tsx,QuotaCard.tsx,Kpi.tsx,Gauge.tsx,Ring.tsx,RequestTable.tsx}`; Modify `web/src/components/Sidebar.tsx` (provider list from `/api/providers`).

**Interfaces:**
- Consumes: `OverviewResponse`, `ProvidersResponse`, `RequestList` (first 5 items), format helpers, `<Brand>`.
- Produces: `<PeriodBar value={{period, anchor}} onChange>` (Ngày/Tuần/Tháng + ‹ › stepping anchor by 1 day/7 days/1 month; label `Thứ Ba, 17/11/2026` / `16 – 22/11/2026` / `Tháng 11/2026`; right text `So với hôm qua|tuần trước|tháng 10`); `<RequestTable rows compact? onOpen(id)>` reused by Task 8 (columns per spec; compact = Thời gian, Agent, Model, Trạng thái, Input/Output, Credit, Độ trễ).
- Page per mockup: greeting `Xin chào, {settings.displayName}` + `Chào mừng trở lại. Gateway đang chạy ổn định.` (or `Gateway đang tạm dừng.` when `!settings.enabled`); provider tabs (Tất cả + configured providers, active = accent-soft); QuotaCard (all: month estimated credits vs `monthlyCreditBudget`; kiro: `used / limit credit`, remaining, reset date, plan; anthropic: `$monthCost / $budget`; openrouter: `$balance số dư`; `ok:false` → "Không lấy được số liệu" + reported credits from stats); 4 KPIs with deltas vs `previous`; row Ngân sách tháng (gauge, hidden text "Chưa đặt mục tiêu" when budget 0) · Tiết kiệm credit (`saved_tokens`, `cache_hits`, ring = saved/(saved+input)) · Model đang dùng; Request gần đây. No traffic chart. Refresh button refetches.

- [ ] **Step 1:** Implement components and page against the live API (`npm run dev` + `npm run dev:web`).
- [ ] **Step 2:** `npm run check && npm run build:web` → PASS.
- [ ] **Step 3:** Commit `feat(web): overview page`.

### Task 8: Requests page and request dialog

**Files:** Create `web/src/pages/Requests.tsx`, `web/src/components/{RequestDialog.tsx,Stepper.tsx,CodeBox.tsx,ConfirmClear.tsx}`, `web/src/lib/highlight.ts`; extend `tests/web-lib.test.ts`.

**Interfaces:**
- Consumes: `RequestList`, `RequestDetail`, `Step`, `<RequestTable>`, `<PeriodBar>` (or a period `<select>`: Hôm nay / Tuần này / Tháng này).
- Produces: `highlightJson(text: string): string` and `highlightSse(text: string): string` (HTML-escaped spans `tk-k|tk-s|tk-n|tk-b|tk-p|tk-e`, same regex as the mockup); `prettyJson(text: string): string` (pretty-prints when parseable, returns input otherwise).
- Page: summary cards from `summary`; filters (search `q` debounced 300 ms, status seg, provider select); table + pagination (10/25/50/100); Xuất CSV (`/api/export` with same params, download via `<a href>` with session cookie); Xóa log → `ConfirmClear` (options "Log cũ hơn 7 ngày" → `?before=now-7d`, "Toàn bộ log"), toast with deleted count; info strip about totals being kept.
- Dialog: title `{clientLabel} → {model}`, status pill, time, latency; tabs Tổng quan (info grid: Máy gọi = client + user agent, IP nguồn, Vị trí = city, country · Cloudflare colo, Nhà cung cấp, Model, Input/output, Credit, Request ID, Endpoint) + `Stepper` (columns Thời điểm `fmtClock(started+at)` | icon | Bước label + detail | Thời lượng + waterfall bar; labels: received "Nhận request", auth "Xác thực API key", optimize "Tiết kiệm credit", cache "Trả lời từ cache", local "Trả lời tại chỗ", upstream "Gửi tới {provider}", stream "Nhận stream" / "Đang nhận stream", done "Hoàn tất", error "Kết thúc với lỗi"; poll detail every 2 s while `status===0`); Request / Response tabs use `CodeBox` (file name `request.json` / `response.sse` or `response.json`, size, line count, wrap toggle, copy with clipboard fallback to selecting text); no payload → hint `Bật "Lưu payload & response" trong Cài đặt → Dữ liệu & log để xem nội dung.`; Lỗi tab: error code, `error_message`, a fix hint map (`kiro_http_530` → đổi API region; `rate_limit` / `upstream_http_429` → đợi hoặc tăng hạn mức; `kiro_auth_failed` → tải lại token Kiro; default → none). Dialog opens on the Lỗi tab for failed rows.

- [ ] **Step 1: Failing tests:** `highlightJson('{"a":1,"b":"x","c":true}')` contains `<span class="tk-k">"a"</span>`, `<span class="tk-n">1</span>`, `<span class="tk-s">"x"</span>`, `<span class="tk-b">true</span>`; `highlightJson('{"x":"<b>"}')` contains `&lt;b&gt;`; `highlightSse('event: ping\ndata: {"k":1}')` contains `<span class="tk-e">event:</span>`; `prettyJson("{\"a\":1}") === '{\n  "a": 1\n}'`; `prettyJson("nope") === "nope"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm run check && npm test && npm run build:web` → PASS.
- [ ] **Step 5:** Commit `feat(web): request history and detail dialog`.

### Task 9: Settings page

**Files:** Create `web/src/pages/Settings.tsx`, `web/src/pages/settings/{General,Kiro,ClaudeApi,OpenRouter,Saving,Budget,Connect,Data}.tsx`, `web/src/components/{Switch.tsx,Row.tsx,SaveBar.tsx}`.

**Interfaces:**
- Consumes: `GET/PUT /api/settings` (`{ settings, secrets }`), `GET/PUT /api/kiro`, `POST /api/vault/reset`, `GET /api/providers`.
- Left menu of 8 sections (labels exactly: Chung, Kiro, Claude API, OpenRouter, Tiết kiệm credit, Ngân sách, Kết nối & bảo mật, Dữ liệu & log); section in URL hash (`/settings#kiro`). Draft state; SaveBar shows `Có N thay đổi chưa lưu` + `Lưu cài đặt`, disabled when 0; server validation error shown in SaveBar.
- Fields: Chung — displayName, enabled, requestsPerMinute, timeoutSeconds, models (textarea). Kiro — credentials status + plan/credit from providers, upload (file input multiple + paste JSON, same payload shape the current `public/app.js` sends to `PUT /api/kiro`: `{credentials, registration}`), apiRegion, kiroVersion, vault reset (confirm dialog). Claude API — key status, month cost, anthropicMonthlyBudgetUsd. OpenRouter — key status, balance. Tiết kiệm credit — clearToolResults, clearTriggerTokens, clearKeepToolUses, clearToolInputs, compactEnabled, compactTriggerTokens, compactKeepTokens, compactModel, responseCacheSeconds. Ngân sách — inputCreditsPerMillion, outputCreditsPerMillion (live formula line), monthlyCreditBudget. Kết nối & bảo mật — base URL `${location.origin}/v1` + copy, secrets status list. Dữ liệu & log — retentionDays, capturePayloads (seg Tắt / Chỉ khi lỗi / Tất cả, with privacy note), payloadRetentionDays, "Thống kê theo ngày/tuần/tháng được giữ vĩnh viễn", Xóa log (reuses `ConfirmClear`).

- [ ] **Step 1:** Implement. **Step 2:** `npm run check && npm run build:web` → PASS; manual: change a field, save, reload → persisted.
- [ ] **Step 3:** Commit `feat(web): settings with sections`.

### Task 10: Remove legacy UI, docs, end-to-end verification

**Files:** Delete `public/` (app.js, index.html, style.css, theme.js, fonts.css and any leftovers); Modify `README.md` (dashboard section: React app in `web/`, `npm run dev` + `npm run dev:web`, build/deploy scripts, payload capture privacy note, stats retention), `docs/mockups/console-redesign.html` unchanged.

- [ ] **Step 1:** Delete legacy files; `grep -r "public/" src tests package.json wrangler.jsonc` → no stale references.
- [ ] **Step 2:** `npm run check && npm test && npm run test:integration` → PASS.
- [ ] **Step 3:** Run `npm run build:web && npx wrangler dev` with local `.dev.vars`; open `/login`, `/overview`, `/requests` (+ dialog), `/settings` in light and dark; screenshot each; fix visual regressions against the mockup.
- [ ] **Step 4:** Commit `chore: remove legacy dashboard, update README`.

## Execution lanes

Tasks 1→2→3→4→5 (backend) and 6→7→8→9 (frontend) can run in parallel after Task 2 lands (frontend needs only `contract.ts` and settings types). Task 10 runs last.
