export default function Ring({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <svg
      className="ring"
      viewBox="0 0 120 120"
      role="img"
      aria-label={`${Math.round(pct)}% token đã tiết kiệm`}
    >
      <circle
        cx="60"
        cy="60"
        r="50"
        fill="none"
        stroke="var(--grid)"
        strokeWidth="10"
      />
      <circle
        cx="60"
        cy="60"
        r="50"
        fill="none"
        stroke="var(--good)"
        strokeWidth="10"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray={`${pct} 100`}
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="61"
        textAnchor="middle"
        fill="var(--ink)"
        fontSize="24"
        fontWeight="700"
      >
        {Math.round(pct)}%
      </text>
      <text x="60" y="78" textAnchor="middle" fill="var(--muted)" fontSize="10">
        đã tiết kiệm
      </text>
    </svg>
  );
}
