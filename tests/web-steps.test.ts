import test from "node:test";
import assert from "node:assert/strict";
import type { Step, StepKey } from "../src/dashboard/contract.ts";
import { presentStep, stepDuration } from "../web/src/lib/steps.ts";

const step = (key: StepKey, detail: string, overrides: Partial<Step> = {}): Step => ({
  key, detail, state: "done", at: 0, dur: 0, ...overrides,
});

test("step details translate Vietnamese codes within their trace stage", () => {
  const cases: [StepKey, string, string][] = [
    ["optimize", "below_threshold", "Không cần: prompt dưới ngưỡng"],
    ["optimize", "not_kiro", "Chỉ áp dụng cho Kiro"],
    ["optimize", "cleared:12", "Xóa 12 tool result cũ"],
    ["optimize", "compact", "Dùng bản tóm tắt đã lưu"],
    ["optimize", "compact_new", "Tóm tắt phần đầu hội thoại"],
    ["optimize", "cleared:2 · compact_new", "Xóa 2 tool result cũ · Tóm tắt phần đầu hội thoại"],
    ["cache", "miss", "Không có trong cache"],
    ["cache", "hit", "Trả lời từ cache, không tính credit"],
    ["local", "max_tokens_1", "max_tokens = 1, trả lời tại chỗ"],
    ["received", "claude-code · 127.0.0.1", "Claude Code · 127.0.0.1"],
    ["received", "cursor · ::1", "Cursor · ::1"],
    ["received", "custom-client · ::1", "custom-client · ::1"],
    ["error", "kiro_http_530", "kiro_http_530"],
    ["error", "below_threshold", "below_threshold"],
    ["optimize", "future_code", "future_code"],
    ["optimize", "cleared:invalid", "cleared:invalid"],
    ["cache", "future_code", "future_code"],
    ["local", "future_code", "future_code"],
    ["auth", "hit", "hit"],
    ["upstream", "", ""],
  ];
  for (const [key, detail, expected] of cases) {
    const original = step(key, detail);
    assert.equal(presentStep(original).detail, expected);
    assert.equal(original.detail, detail, "does not mutate API data");
  }
});

test("cache misses are skipped and hits keep their status", () => {
  const miss = presentStep(step("cache", "miss"));
  assert.equal(miss.state, "skip");
  assert.equal(stepDuration(miss), "—");
  assert.equal(presentStep(step("cache", "hit")).state, "done");
});

test("duration distinguishes zero, skipped, unreached and running steps", () => {
  assert.equal(stepDuration(step("received", "")), "<1 ms");
  assert.equal(stepDuration(step("error", "", { state: "error" })), "<1 ms");
  assert.equal(stepDuration(step("done", "", { dur: 123 })), "123 ms");
  assert.equal(stepDuration(step("done", "", { dur: 1200 })), "1,2 s");
  assert.equal(stepDuration(step("optimize", "", { state: "skip" })), "—");
  assert.equal(stepDuration(step("done", "", { state: "pending" })), "—");
  assert.equal(stepDuration(step("done", "", { at: null, dur: null })), "—");
  assert.equal(stepDuration(step("stream", "", { state: "active", dur: null })), "Đang chạy");
  assert.equal(stepDuration(step("received", "", { state: "done", dur: null })), "<1 ms");
  assert.equal(stepDuration(step("error", "", { state: "error", dur: null })), "<1 ms");
});
