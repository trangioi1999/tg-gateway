const HOUR = 3_600_000;

/**
 * Start of the earliest prompt in each hour, for "first prompt of the day". Kept apart from
 * `requests` so it survives clearing the history and retention.
 */
export const PROMPTS_TABLE =
  "CREATE TABLE IF NOT EXISTS prompt_hours (hour INTEGER PRIMARY KEY, first INTEGER NOT NULL)";

/**
 * Whether a request is someone's prompt: Claude Code's main session or a request from any
 * other client. Not Claude Code's side calls (session title, auto-mode check, subagents),
 * its 1-token quota probe, or the gateway's own summary calls.
 */
export function isPrompt(r: { client: string; agent: string | null; optimizations: string }): boolean {
  return (
    r.client !== "tg-gateway" &&
    (r.agent === null || r.agent === "main") &&
    !r.optimizations.split(",").includes("local_reply")
  );
}

export function recordPrompt(sql: SqlStorage, started: number): void {
  sql.exec(
    "INSERT INTO prompt_hours VALUES(?,?) ON CONFLICT(hour) DO UPDATE SET first=MIN(first,excluded.first)",
    Math.floor(started / HOUR),
    started,
  );
}

/** One-time: from the finished rows still in `requests`. Same rule as isPrompt. */
export function backfillPrompts(sql: SqlStorage): void {
  sql.exec(`INSERT OR IGNORE INTO prompt_hours
    SELECT started/${HOUR}, MIN(started) FROM requests
    WHERE status<>0 AND client<>'tg-gateway' AND (agent IS NULL OR agent='main')
      AND (','||optimizations||',') NOT LIKE '%,local_reply,%'
    GROUP BY 1`);
}

/** Start time of the first prompt in [from, to), or null. */
export function firstPrompt(sql: SqlStorage, from: number, to: number): number | null {
  return sql
    .exec<{ first: number | null }>("SELECT MIN(first) first FROM prompt_hours WHERE first>=? AND first<?", from, to)
    .one().first;
}
