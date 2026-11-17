import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { STATS_TABLE, backfillStats, recordStats, fromRow, totals, grouped, STATS_SOURCE, type StatsSourceRow } from "../src/db/stats.ts";

// Minimal SqlStorage stand-in over node:sqlite (exec + toArray/one).
function storage() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...args: unknown[]) {
      const rows = db.prepare(query).all(...(args as never[]));
      return { toArray: () => rows, one: () => rows[0] };
    },
  } as unknown as SqlStorage;
  sql.exec(`CREATE TABLE requests (id TEXT PRIMARY KEY, started INTEGER, provider TEXT, client TEXT, model TEXT,
    status INTEGER, latency INTEGER, input_tokens INTEGER, output_tokens INTEGER, estimated_credits REAL,
    reported_credits REAL, cost_usd REAL, saved_tokens INTEGER, optimizations TEXT)`);
  sql.exec(STATS_TABLE);
  return sql;
}
const H = 3_600_000;
const rows: [string, number, string, number, number, number | null, number | null, string][] = [
  ["a", 10 * H + 5, "kiro", 200, 100, 0.5, null, ""],
  ["b", 10 * H + 9, "kiro", 502, 300, null, null, "cleared:1"],
  ["c", 10 * H + 20, "kiro", 200, 0, null, null, "cache_hit"],
  ["d", 11 * H, "openrouter", 200, 50, null, 0.002, ""],
  ["e", 11 * H + 1, "kiro", 0, 0, null, null, ""], // in flight: not counted
];
function seed(sql: SqlStorage) {
  for (const [id, started, provider, status, latency, reported, cost, opt] of rows)
    sql.exec("INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, started, provider, "cli", "m1",
      status, latency, 10, 5, 0.25, reported, cost, 3, opt);
}

test("backfill and live upserts agree", () => {
  const a = storage(), b = storage();
  seed(a);
  seed(b);
  backfillStats(a);
  for (const row of b.exec(`SELECT ${STATS_SOURCE} FROM requests WHERE status<>0`).toArray() as StatsSourceRow[])
    recordStats(b, fromRow(row));
  const ta = totals(a, 0, 12 * H), tb = totals(b, 0, 12 * H);
  assert.deepEqual(ta, tb);
  assert.equal(ta.requests, 4);
  assert.equal(ta.successful, 3);
  assert.equal(ta.failed, 1);
  assert.equal(ta.cache_hits, 1);
  assert.equal(ta.reported_requests, 1);
  assert.equal(ta.reported_credits, 0.5);
  assert.equal(ta.cost_usd, 0.002);
  assert.equal(ta.avg_latency, 450 / 4);
  assert.deepEqual(grouped(a, 0, 12 * H, "provider"), grouped(b, 0, 12 * H, "provider"));
});

test("hour window and provider filter", () => {
  const sql = storage();
  seed(sql);
  backfillStats(sql);
  assert.equal(totals(sql, 10 * H, 11 * H).requests, 3);
  assert.equal(totals(sql, 11 * H, 11 * H + 1).requests, 1, "partial hour rounds out");
  assert.equal(totals(sql, 0, 12 * H, "openrouter").requests, 1);
  assert.equal(totals(sql, 20 * H, 21 * H).avg_latency, 0);
  const byModel = grouped(sql, 0, 12 * H, "model");
  assert.deepEqual(byModel.map((r) => [r.model, r.provider, r.requests]), [["m1", "kiro", 3], ["m1", "openrouter", 1]]);
});
