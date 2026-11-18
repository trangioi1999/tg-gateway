import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PROMPTS_TABLE, isPrompt, recordPrompt, backfillPrompts, firstPrompt } from "../src/db/prompts.ts";

function storage() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...args: unknown[]) {
      const rows = db.prepare(query).all(...(args as never[]));
      return { toArray: () => rows, one: () => rows[0] };
    },
  } as unknown as SqlStorage;
}
const H = 3_600_000;

test("only real prompts count: main session and other clients", () => {
  assert.equal(isPrompt({ client: "claude-code", agent: "main", optimizations: "" }), true);
  assert.equal(isPrompt({ client: "cursor", agent: null, optimizations: "" }), true);
  assert.equal(isPrompt({ client: "claude-code", agent: "background", optimizations: "" }), false);
  assert.equal(isPrompt({ client: "claude-code", agent: "subagent", optimizations: "" }), false);
  assert.equal(isPrompt({ client: "claude-code", agent: "auto-mode", optimizations: "" }), false);
  assert.equal(isPrompt({ client: "claude-code", agent: "main", optimizations: "local_reply" }), false);
  assert.equal(isPrompt({ client: "tg-gateway", agent: null, optimizations: "" }), false);
});

test("first prompt of a day: earliest kept per hour, independent of the request history", () => {
  const sql = storage();
  sql.exec(PROMPTS_TABLE);
  recordPrompt(sql, 9 * H + 30_000);
  recordPrompt(sql, 9 * H + 10_000);
  recordPrompt(sql, 8 * H + 600_000);
  recordPrompt(sql, 26 * H);
  assert.equal(firstPrompt(sql, 0, 24 * H), 8 * H + 600_000);
  assert.equal(firstPrompt(sql, 24 * H, 48 * H), 26 * H);
  assert.equal(firstPrompt(sql, 48 * H, 72 * H), null);
});

test("backfill uses the same rule as isPrompt", () => {
  const sql = storage();
  sql.exec("CREATE TABLE requests (started INTEGER, status INTEGER, client TEXT, agent TEXT, optimizations TEXT)");
  for (const [started, status, client, agent, opt] of [
    [7 * H, 200, "claude-code", "background", ""],
    [7 * H + 5, 200, "claude-code", "main", "local_reply"],
    [7 * H + 9, 200, "tg-gateway", null, ""],
    [7 * H + 20, 0, "claude-code", "main", ""],
    [8 * H, 502, "claude-code", "main", ""],
  ] as const)
    sql.exec("INSERT INTO requests VALUES(?,?,?,?,?)", started, status, client, agent, opt);
  sql.exec(PROMPTS_TABLE);
  backfillPrompts(sql);
  assert.equal(firstPrompt(sql, 0, 24 * H), 8 * H);
});
