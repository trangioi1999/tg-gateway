import { fmtDelta } from "../lib/format";
export default function Kpi({
  label,
  value,
  current,
  previous,
  better = "up",
  comparison,
  note,
}: {
  label: string;
  value: string;
  current: number;
  previous: number;
  better?: "up" | "down";
  comparison: string;
  /** Extra detail after the label, e.g. the input/output split. */
  note?: string;
}) {
  return (
    <article className="card kpi">
      <div className="k">{label}{note && <span className="kn">{note}</span>}</div>
      <strong className="num">{value}</strong>
      <small><span className={previous === 0 || current === previous ? undefined : ((current > previous) === (better === "up") ? "up" : "down")}>{fmtDelta(current, previous)}</span> {comparison}</small>
    </article>
  );
}
