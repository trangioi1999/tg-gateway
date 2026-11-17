import test from "node:test";
import assert from "node:assert/strict";
import { parsePeriod, periodRange } from "../src/dashboard/period.ts";

const H = 3600_000, D = 24 * H;
test("day in UTC+7 starts at local midnight", () => {
  const r = periodRange("day", "2026-11-17", 420);
  assert.equal(r.from, Date.UTC(2026, 10, 17) - 7 * H);
  assert.equal(r.to, r.from + D);
  assert.equal(r.previousTo, r.from);
  assert.equal(r.previousFrom, r.from - D);
});
test("week starts on Monday", () => {
  const r = periodRange("week", "2026-11-19", 0); // Thursday
  assert.equal(r.from, Date.UTC(2026, 10, 16));
  assert.equal(r.to, Date.UTC(2026, 10, 23));
  assert.equal(r.previousFrom, Date.UTC(2026, 10, 9));
});
test("month uses calendar months; previous month has its own length", () => {
  const r = periodRange("month", "2026-03-10", 0);
  assert.equal(r.from, Date.UTC(2026, 2, 1));
  assert.equal(r.to, Date.UTC(2026, 3, 1));
  assert.equal(r.previousFrom, Date.UTC(2026, 1, 1));
  assert.equal(r.previousTo, Date.UTC(2026, 2, 1));
});
test("parsePeriod rejects bad input", () => {
  assert.throws(() => parsePeriod(new URL("https://x/?period=year")), /invalid_range|period/);
  assert.throws(() => parsePeriod(new URL("https://x/?anchor=2026-13-01")));
  assert.throws(() => parsePeriod(new URL("https://x/?anchor=2026-02-30")));
  assert.throws(() => parsePeriod(new URL("https://x/?tz=9999")));
  assert.throws(() => parsePeriod(new URL("https://x/?tz=1.5")));
});
test("parsePeriod defaults to the current week in the viewer's tz", () => {
  const now = Date.UTC(2026, 10, 19, 20, 0); // Thu 20:00 UTC = Fri 03:00 at UTC+7
  const r = parsePeriod(new URL("https://x/?tz=420"), now);
  assert.equal(r.period, "week");
  assert.equal(r.from, Date.UTC(2026, 10, 16) - 7 * H);
});
