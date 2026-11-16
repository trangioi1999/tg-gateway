import { test } from "node:test";
import assert from "node:assert/strict";
import { detectClient } from "../src/clients.ts";

const detect = (h: Record<string, string>) => detectClient(new Headers(h));

test("detects common agent clients from headers", () => {
  // Captured from Claude Code 2.1.325 in print mode.
  assert.equal(
    detect({ "user-agent": "claude-cli/2.1.325 (external, sdk-cli)", "x-stainless-lang": "js" }),
    "claude-code",
  );
  assert.equal(detect({ "user-agent": "claude-cli/2.1.325 (external, cli)" }), "claude-code");
  assert.equal(
    detect({ "user-agent": "claude-cli/2.1.325 (external, claude-vscode)" }),
    "claude-code-ide",
  );
  assert.equal(detect({ "user-agent": "Cline/3.20.0" }), "cline");
  assert.equal(detect({ "user-agent": "RooCode/3.1" }), "roo-code");
  assert.equal(detect({ "user-agent": "curl/8.7.1" }), "curl");
  assert.equal(detect({ "user-agent": "OpenAI/JS 4.80.0" }), "openai-sdk");
  assert.equal(detect({ "user-agent": "Anthropic/Python 0.40.0" }), "anthropic-sdk");
  assert.equal(
    detect({ "user-agent": "node", "x-stainless-lang": "js", "anthropic-version": "2023-06-01" }),
    "anthropic-sdk",
  );
  assert.equal(detect({ "user-agent": "GeminiCLI/0.9.0" }), "gemini-cli");
  assert.equal(
    detect({ "user-agent": "node", "http-referer": "https://openrouter.ai" }),
    "openrouter",
  );
  assert.equal(detect({}), "other");
});
