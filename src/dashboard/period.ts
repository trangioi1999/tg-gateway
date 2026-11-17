import { HttpError } from "../types.ts";
import type { Period, Range } from "./contract.ts";

const MIN = 60_000, DAY = 86_400_000;

function bad(message: string): never {
  throw new HttpError(400, "invalid_range", message);
}

/** Range for the period containing `anchor` (YYYY-MM-DD), in the viewer's local time (tz = minutes east of UTC). */
export function periodRange(period: Period, anchor: string, tzMinutes: number): Range {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!m) bad("anchor must be YYYY-MM-DD");
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(Date.UTC(y, mo, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo || date.getUTCDate() !== d)
    bad("anchor is not a real date");
  const local = (ms: number) => ms - tzMinutes * MIN;
  const day = Date.UTC(y, mo, d);
  if (period === "day")
    return { period, from: local(day), to: local(day + DAY), previousFrom: local(day - DAY), previousTo: local(day) };
  if (period === "week") {
    const start = day - ((date.getUTCDay() + 6) % 7) * DAY;
    return { period, from: local(start), to: local(start + 7 * DAY), previousFrom: local(start - 7 * DAY), previousTo: local(start) };
  }
  return {
    period,
    from: local(Date.UTC(y, mo, 1)),
    to: local(Date.UTC(y, mo + 1, 1)),
    previousFrom: local(Date.UTC(y, mo - 1, 1)),
    previousTo: local(Date.UTC(y, mo, 1)),
  };
}

export function parsePeriod(url: URL, now = Date.now()): Range {
  const period = url.searchParams.get("period") ?? "week";
  if (period !== "day" && period !== "week" && period !== "month") bad("period must be day, week or month");
  const tzRaw = url.searchParams.get("tz") ?? "0";
  const tz = /^-?\d+$/.test(tzRaw) ? Number(tzRaw) : NaN;
  if (!Number.isInteger(tz) || tz < -840 || tz > 840) bad("tz must be an integer between -840 and 840");
  let anchor = url.searchParams.get("anchor");
  if (anchor === null) {
    const t = new Date(now + tz * MIN);
    anchor = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  }
  return periodRange(period, anchor, tz);
}
