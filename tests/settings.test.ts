import test from "node:test";
import assert from "node:assert/strict";
import { defaults, validateSettings } from "../src/types.ts";

test("defaults validate and include new fields", () => {
  const s = validateSettings({ ...defaults });
  assert.equal(s.displayName, "Admin");
  assert.equal(s.capturePayloads, "off");
  assert.equal(s.payloadRetentionDays, 3);
  assert.equal(s.anthropicMonthlyBudgetUsd, 0);
});
test("rejects bad capturePayloads", () => {
  assert.throws(() => validateSettings({ ...defaults, capturePayloads: "sometimes" }));
});
test("rejects bad displayName", () => {
  for (const displayName of ["", "   ", "x".repeat(41), "a\nb", "a\u007f", 5])
    assert.throws(() => validateSettings({ ...defaults, displayName }));
});
test("rejects bad retention and budget", () => {
  assert.throws(() => validateSettings({ ...defaults, payloadRetentionDays: 0 }));
  assert.throws(() => validateSettings({ ...defaults, payloadRetentionDays: 31 }));
  assert.throws(() => validateSettings({ ...defaults, anthropicMonthlyBudgetUsd: -1 }));
  assert.throws(() => validateSettings({ ...defaults, anthropicMonthlyBudgetUsd: 1e6 + 1 }));
});
test("still rejects unknown keys", () => {
  assert.throws(() => validateSettings({ ...defaults, nope: 1 }));
});
