export default function Skeleton({ rows = 1, className = "" }: { rows?: number; className?: string }) {
  return <span className={`skeleton-group ${className}`} role="status" aria-label="Đang tải dữ liệu">
    {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton" aria-hidden="true" />)}
  </span>;
}
