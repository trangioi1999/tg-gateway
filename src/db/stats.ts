import type { Totals } from "../dashboard/contract.ts";

const HOUR = 3_600_000;

/** Hourly aggregates of finished requests. Never cleared by history deletion or retention. */
export const STATS_TABLE = `CREATE TABLE IF NOT EXISTS stats_hourly (
  hour INTEGER NOT NULL, provider TEXT NOT NULL, client TEXT NOT NULL, model TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0, successful INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_credits REAL NOT NULL DEFAULT 0, reported_credits REAL NOT NULL DEFAULT 0,
  reported_requests INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
  saved_tokens INTEGER NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0,
  latency_sum INTEGER NOT NULL DEFAULT 0, latency_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(hour, provider, client, model))`;

export interface FinishedRequest {
  started: number;
  provider: string;
  client: string;
  model: string;
  status: number;
  latency: number;
  input_tokens: number;
  output_tokens: number;
  estimated_credits: number;
  reported_credits: number | null;
  cost_usd: number | null;
  saved_tokens: number;
  cache_hit: boolean;
}

const SUMMED = [
  "requests", "successful", "failed", "input_tokens", "output_tokens", "estimated_credits",
  "reported_credits", "reported_requests", "cost_usd", "saved_tokens", "cache_hits",
  "latency_sum", "latency_count",
] as const;

export function recordStats(sql: SqlStorage, r: FinishedRequest): void {
  const timed = r.status !== 0;
  sql.exec(
    `INSERT INTO stats_hourly(hour,provider,client,model,${SUMMED.join(",")})
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(hour,provider,client,model) DO UPDATE SET
     ${SUMMED.map((c) => `${c}=${c}+excluded.${c}`).join(",")}`,
    Math.floor(r.started / HOUR),
    r.provider,
    r.client,
    r.model,
    1,
    r.status >= 200 && r.status < 300 ? 1 : 0,
    r.status >= 400 ? 1 : 0,
    r.input_tokens,
    r.output_tokens,
    r.estimated_credits,
    r.reported_credits ?? 0,
    r.reported_credits === null ? 0 : 1,
    r.cost_usd ?? 0,
    r.saved_tokens,
    r.cache_hit ? 1 : 0,
    timed ? r.latency : 0,
    timed ? 1 : 0,
  );
}

/** Columns of `requests` needed to call recordStats for a row. */
export const STATS_SOURCE =
  "started,provider,client,model,status,latency,input_tokens,output_tokens,estimated_credits,reported_credits,cost_usd,saved_tokens,optimizations";

export type StatsSourceRow = Omit<FinishedRequest, "cache_hit"> & { optimizations: string };

export function fromRow(row: StatsSourceRow): FinishedRequest {
  const { optimizations, ...rest } = row;
  return { ...rest, cache_hit: optimizations.split(",").includes("cache_hit") };
}

/** One-time: aggregate every finished row already in `requests`. Assumes stats_hourly is empty. */
export function backfillStats(sql: SqlStorage): void {
  sql.exec(`INSERT INTO stats_hourly(hour,provider,client,model,${SUMMED.join(",")})
    SELECT started/${HOUR}, provider, client, model, COUNT(*),
      SUM(status>=200 AND status<300), SUM(status>=400),
      SUM(input_tokens), SUM(output_tokens), SUM(estimated_credits),
      COALESCE(SUM(reported_credits),0), COUNT(reported_credits), COALESCE(SUM(cost_usd),0),
      SUM(saved_tokens), SUM((','||optimizations||',') LIKE '%,cache_hit,%'),
      SUM(latency), COUNT(*)
    FROM requests WHERE status<>0 GROUP BY 1,2,3,4`);
}

const AGGREGATE = `COALESCE(SUM(requests),0) requests, COALESCE(SUM(successful),0) successful,
  COALESCE(SUM(failed),0) failed, COALESCE(SUM(input_tokens),0) input_tokens,
  COALESCE(SUM(output_tokens),0) output_tokens, COALESCE(SUM(estimated_credits),0) estimated_credits,
  COALESCE(SUM(reported_credits),0) reported_credits, COALESCE(SUM(reported_requests),0) reported_requests,
  COALESCE(SUM(cost_usd),0) cost_usd, COALESCE(SUM(saved_tokens),0) saved_tokens,
  COALESCE(SUM(cache_hits),0) cache_hits,
  CASE WHEN SUM(latency_count)>0 THEN CAST(SUM(latency_sum) AS REAL)/SUM(latency_count) ELSE 0 END avg_latency`;

function where(from: number, to: number, provider?: string) {
  let clause = "hour>=? AND hour<?";
  const args: (string | number)[] = [Math.floor(from / HOUR), Math.ceil(to / HOUR)];
  if (provider) {
    clause += " AND provider=?";
    args.push(provider);
  }
  return { clause, args };
}

export function totals(sql: SqlStorage, from: number, to: number, provider?: string): Totals {
  const { clause, args } = where(from, to, provider);
  return sql.exec<Totals & Record<string, number>>(`SELECT ${AGGREGATE} FROM stats_hourly WHERE ${clause}`, ...args).one();
}

/** Totals per provider, model (with its provider; unnamed models skipped) or client, busiest first. */
export function grouped(
  sql: SqlStorage,
  from: number,
  to: number,
  by: "provider" | "model" | "client",
  provider?: string,
): (Totals & Record<string, string>)[] {
  const { clause, args } = where(from, to, provider);
  const keys = by === "model" ? "model,provider" : by;
  const extra = by === "model" ? " AND model<>''" : "";
  return sql
    .exec(`SELECT ${keys}, ${AGGREGATE} FROM stats_hourly WHERE ${clause}${extra} GROUP BY ${keys} ORDER BY requests DESC`, ...args)
    .toArray() as unknown as (Totals & Record<string, string>)[];
}
