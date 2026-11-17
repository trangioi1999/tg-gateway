const number = (n: number, digits = 0) =>
  n.toLocaleString("vi-VN", { maximumFractionDigits: digits });
export const fmtInt = (n: number) => number(n);
export const fmtCompact = (n: number) =>
  Math.abs(n) >= 1e6
    ? number(n / 1e6, 1) + "M"
    : Math.abs(n) >= 1e3
      ? number(n / 1e3, 1) + "K"
      : number(n, 1);
export const fmtMs = (ms: number) =>
  ms < 1000 ? number(ms) + " ms" : number(ms / 1000, 1) + " s";
export const fmtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
export const fmtDelta = (cur: number, prev: number) =>
  prev === 0
    ? "—"
    : (cur >= prev ? "+" : "−") +
      number(Math.abs(((cur - prev) / prev) * 100)) +
      "%";
