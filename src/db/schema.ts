import { defaults } from "../types.ts";
import { STATS_TABLE, backfillStats } from "./stats.ts";

/** Payloads whose request row is gone (retention, history clearing). */
export const DELETE_ORPHAN_PAYLOADS = "DELETE FROM payloads WHERE id NOT IN (SELECT id FROM requests)";

export function migrate(storage: DurableObjectStorage): void {
    const sql = storage.sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)`,
    );
    sql.exec(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, started INTEGER NOT NULL, finished INTEGER, endpoint TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL DEFAULT 0, latency INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0, input_source TEXT NOT NULL DEFAULT 'unknown',output_source TEXT NOT NULL DEFAULT 'unknown',
      reported_credits REAL, estimated_credits REAL NOT NULL DEFAULT 0, input_rate REAL NOT NULL DEFAULT 0, output_rate REAL NOT NULL DEFAULT 0,
      error_code TEXT, context_percent REAL, streamed INTEGER NOT NULL DEFAULT 0)`);
    sql.exec(
      `CREATE INDEX IF NOT EXISTS requests_time ON requests(started)`,
    );
    // Columns added after v0.1. CREATE TABLE IF NOT EXISTS does not alter existing tables.
    const columns = new Set(
      sql
        .exec<{ name: string }>("PRAGMA table_info(requests)")
        .toArray()
        .map((c) => c.name),
    );
    if (!columns.has("client"))
      sql.exec(
        "ALTER TABLE requests ADD COLUMN client TEXT NOT NULL DEFAULT 'other'",
      );
    if (!columns.has("provider"))
      sql.exec(
        "ALTER TABLE requests ADD COLUMN provider TEXT NOT NULL DEFAULT 'kiro'",
      );
    if (!columns.has("cost_usd"))
      sql.exec("ALTER TABLE requests ADD COLUMN cost_usd REAL");
    if (!columns.has("optimizations"))
      sql.exec(
        "ALTER TABLE requests ADD COLUMN optimizations TEXT NOT NULL DEFAULT ''",
      );
    if (!columns.has("saved_tokens"))
      sql.exec(
        "ALTER TABLE requests ADD COLUMN saved_tokens INTEGER NOT NULL DEFAULT 0",
      );
    // Request source and trace (dashboard detail view).
    for (const [name, type] of [
      ["ip", "TEXT"],
      ["country", "TEXT"],
      ["city", "TEXT"],
      ["colo", "TEXT"],
      ["user_agent", "TEXT"],
      ["error_message", "TEXT"],
      ["upstream_host", "TEXT"],
      ["ttfb", "INTEGER"],
      ["steps", "TEXT"],
      ["agent", "TEXT"],
      ["claude_session", "TEXT"],
      ["kiro_conversation", "TEXT"],
      ["context", "TEXT"],
    ])
      if (!columns.has(name))
        sql.exec(`ALTER TABLE requests ADD COLUMN ${name} ${type}`);
    // Captured request/response text (only when capturePayloads is on); deleted when it is
    // turned off, with the request history, and after payloadRetentionDays.
    sql.exec(
      `CREATE TABLE IF NOT EXISTS payloads (id TEXT PRIMARY KEY, created INTEGER NOT NULL, request TEXT, response TEXT, truncated INTEGER NOT NULL DEFAULT 0)`,
    );
    // Compaction summaries (conversation content): only written when compactEnabled is on,
    // deleted when it is turned off and after min(retentionDays, 7) days.
    sql.exec(
      `CREATE TABLE IF NOT EXISTS summaries (hash TEXT PRIMARY KEY, entries INTEGER NOT NULL, summary TEXT NOT NULL, created INTEGER NOT NULL)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)`,
    );
    // One-time: durable hourly stats, backfilled from finished requests. Durable Object
    // SQLite rejects PRAGMA user_version (SQLITE_AUTH), so the table's existence is the marker.
    const hasStats =
      sql
        .exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stats_hourly'")
        .toArray().length > 0;
    // One transaction: a failed backfill must not leave an empty table that marks it done.
    if (!hasStats)
      storage.transactionSync(() => {
        sql.exec(STATS_TABLE);
        backfillStats(sql);
      });
    sql.exec(
      `INSERT OR IGNORE INTO settings VALUES(1,?)`,
      JSON.stringify(defaults),
    );
}
