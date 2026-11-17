import { fmtCompact } from "../lib/format";
export default function Gauge({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const pct = limit ? (used / limit) * 100 : 0;
  return (
    <div className="gauge">
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
          stroke="var(--accent)"
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
        {limit
          ? `${fmtCompact(used)} / ${fmtCompact(limit)} credit`
          : "Chưa đặt mục tiêu"}
      </span>
    </div>
  );
}
