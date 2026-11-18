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

import { detectAgent } from "../src/clients.ts";
test("detectAgent: markers, Claude Code's own prompts, OpenAI system messages", () => {
  const billing = { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.280;" };
  const sys = (text: string) => ({ system: [billing, { type: "text", text }], messages: [] });
  assert.equal(detectAgent(sys("You are a coder.\n[agent: Coder]\nImplement tasks.")), "coder");
  assert.equal(detectAgent(sys("You are a security monitor for autonomous AI coding agents.\n...")), "auto-mode");
  assert.equal(detectAgent(sys("You are Claude Code, Anthropic's official CLI for Claude.")), "main");
  assert.equal(detectAgent(sys("You are an agent for Claude Code, Anthropic's official CLI for Claude.")), "subagent");
  assert.equal(detectAgent({ system: "Be brief.", messages: [] }), null);
  assert.equal(detectAgent({ messages: [{ role: "system", content: "[agent:leader] plan the work" }] }), "leader");
  assert.equal(detectAgent({ messages: [{ role: "user", content: "[agent:fake]" }] }), null, "only system prompts count");
  assert.equal(detectAgent(null), null);
});

import { autoModeTarget } from "../src/compat.ts";
test("autoModeTarget: only the classifier, only on Kiro, only to an enabled model", () => {
  const s = { ...defaults, models: ["claude-opus-5.5", "claude-sonnet-5.5"], autoModeModel: "claude-sonnet-5.5" };
  const classifier = (model: string) => ({
    model,
    system: [{ type: "text", text: "You are a security monitor for autonomous AI coding agents." }],
    messages: [],
  });
  assert.equal(autoModeTarget(classifier("claude-opus-5-5"), s), true);
  assert.equal(autoModeTarget(classifier("claude-sonnet-5-5"), s), false, "already the target");
  assert.equal(autoModeTarget({ ...classifier("claude-opus-5-5"), system: "You are Claude Code, Anthropic's official CLI for Claude." }, s), false);
  assert.equal(autoModeTarget(classifier("claude-opus-5-5"), { ...s, autoModeModel: "" }), false, "off");
  assert.equal(autoModeTarget(classifier("claude-opus-5-5"), { ...s, models: ["claude-opus-5.5"] }), false, "target not enabled");
  assert.equal(autoModeTarget(classifier("anthropic/claude-opus-5-5"), s), false, "not the Kiro route");
  assert.doesNotThrow(() => validateSettings({ ...s, autoModeModel: "" }));
  assert.throws(() => validateSettings({ ...s, autoModeModel: "anthropic/x y" }));
});
