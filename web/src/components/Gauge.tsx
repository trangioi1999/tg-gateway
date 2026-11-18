import { fmtCompact } from "../lib/format";
/** Usage level of a budget: warn from 80 %, over at 100 %. */
export function tone(pct: number): "" | "warn" | "over" {
  return pct >= 100 ? "over" : pct >= 80 ? "warn" : "";
}
export default function Gauge({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const pct = limit ? (used / limit) * 100 : 0;
  const level = tone(pct);
  return (
    <div className={"gauge " + level}>
      <svg viewBox="0 0 180 100" aria-hidden="true">
        <path
          d="M14 92a76 76 0 0 1 152 0"
          fill="none"
          stroke="var(--grid)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        {pct > 0 && <path
          d="M14 92a76 76 0 0 1 152 0"
          fill="none"
          stroke={level === "over" ? "var(--bad)" : level === "warn" ? "var(--warn)" : "var(--accent)"}
          strokeWidth="12"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${Math.min(100, pct)} 100`}
        />}
      </svg>
      <div className="g num">{limit ? Math.round(pct) + "%" : "—"}</div>
      <div className="scale">
        <span>0</span>
        <span>{fmtCompact(limit)}</span>
      </div>
      <span className="pill num">
        {!limit
          ? "Chưa đặt mục tiêu"
          : used > limit
            ? `Vượt ${fmtCompact(used - limit)} credit`
            : `${fmtCompact(used)} / ${fmtCompact(limit)} credit`}
      </span>
    </div>
  );
}
