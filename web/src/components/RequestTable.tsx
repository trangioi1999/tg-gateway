import type { RequestRow } from "../../../src/dashboard/contract";
import { fmtClock, fmtCredit, fmtInt, fmtMs } from "../lib/format";
import { clientLabel } from "../lib/brands";
import { requestDate, requestStatus, requestSource, savingTags } from "../lib/requestPresentation";
import Brand from "./Brand";
import Skeleton from "./Skeleton";
export default function RequestTable({ rows, compact = false, loading = false, rowCount = 10, onOpen }: {
  rows: RequestRow[]; compact?: boolean; loading?: boolean; rowCount?: number; onOpen: (id: string) => void;
}) {
  return <div className="table-wrap" aria-busy={loading}>
    <table className={compact ? "request-table compact" : "request-table"}>
      <colgroup>{(compact ? [12, 15, 24, 16, 14, 9, 8, 2] : [9, 12, 12, 17, 13, 11, 10, 8, 6, 2]).map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
      <thead><tr>
        <th>Thời gian</th><th>Agent</th>{!compact && <th>Nguồn</th>}<th>Model</th><th>Trạng thái</th>
        <th className="r">Input / output</th><th className="r">{compact ? "Credit" : "Quy đổi / Kiro"}</th>
        {!compact && <th>Tiết kiệm</th>}<th className="r">Độ trễ</th><th aria-label="Chi tiết" />
      </tr></thead>
      <tbody>
        {loading ? Array.from({ length: rowCount }, (_, i) => <tr key={i} className="placeholder-row">{Array.from({ length: compact ? 8 : 10 }, (_, j) => <td key={j}><Skeleton /></td>)}</tr>) : rows.map(r => {
          const status = requestStatus(r), source = requestSource(r), tags = savingTags(r.optimizations, r.saved_tokens);
          return <tr key={r.id} data-i={r.id} tabIndex={0} aria-label={`Xem request ${r.id}`} onClick={() => onOpen(r.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); } }}>
            <td className="tm num">{fmtClock(r.started)}<small>{requestDate(r.started)}</small></td>
            <td className="nw" title={clientLabel(r.client)}><span className="cell-brand"><Brand id={r.client} size={16} /><span>{clientLabel(r.client)}</span></span></td>
            {!compact && <td title={`${source.place} · ${source.ip}`}>{source.place}<small className="mono">{source.ip}</small></td>}
            <td className="mono nw" title={r.model}><span className="cell-brand"><Brand id={r.provider} size={16} /><span>{r.model || "—"}</span></span></td>
            <td title={status.label}><span className={`st ${status.tone}`}>{status.label}</span></td>
            <td className="r num" title={`${fmtInt(r.input_tokens)} / ${fmtInt(r.output_tokens)}`}>{fmtInt(r.input_tokens)} / {r.status === 0 ? "—" : fmtInt(r.output_tokens)}</td>
            <td className="r num">{r.status === 0 ? "—" : fmtCredit(r.estimated_credits)}{!compact && <> / {r.reported_credits === null ? "—" : fmtCredit(r.reported_credits)}</>}</td>
            {!compact && <td title={tags.join(", ")}><div className="saving-tags">{tags.length ? tags.map(tag => <span className={`tag${/^(clear|cache|compact)/.test(tag) ? " save" : ""}`} key={tag}>{tag}</span>) : "—"}</div></td>}
            <td className="r num">{r.status === 0 ? "—" : fmtMs(r.latency)}</td><td className="r chev" aria-hidden="true">›</td>
          </tr>;
        })}
        {!loading && rows.length < rowCount && <tr className="table-remainder" aria-hidden={rows.length ? true : undefined}><td colSpan={compact ? 8 : 10} style={{ height: `calc(var(--request-row-height) * ${rowCount - rows.length})` }}>{!rows.length && <span className="empty">Chưa có request trong kỳ này.</span>}</td></tr>}
      </tbody>
    </table>
  </div>;
}
