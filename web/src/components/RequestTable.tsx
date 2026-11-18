import ActionIcon from "./ActionIcon";
import type { RequestRow } from "../../../src/dashboard/contract";
import { fmtClock, fmtCredit, fmtInt, fmtMs } from "../lib/format";
import { clientLabel, modelBrand, providerLabel } from "../lib/brands";
import { agentLabel, requestDate, requestStatus, requestSource, savingDetails, savingTags } from "../lib/requestPresentation";
import Tip from "./Tip";
import Brand from "./Brand";
import Skeleton from "./Skeleton";
export default function RequestTable({ rows, compact = false, loading = false, rowCount = 10, onOpen, onStop }: {
  rows: RequestRow[]; compact?: boolean; loading?: boolean; rowCount?: number; onOpen: (id: string) => void;
  /** Shows a stop button on running rows. */
  onStop?: (id: string) => void;
}) {
  const columns = compact ? 8 : 11;
  return <div className="table-wrap" aria-busy={loading}>
    <table className={compact ? "request-table compact" : "request-table"}>
      <colgroup>{(compact ? [12, 17, 22, 15, 14, 9, 8, 3] : [8, 12, 9, 12, 10, 11, 8, 8, 11, 7, 4]).map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
      <thead><tr>
        <th>Thời gian</th><th>Agent</th>{!compact && <th>Nguồn</th>}<th>Model</th>{!compact && <th>Nhà cung cấp</th>}<th>Trạng thái</th>
        <th className="r">Input / output</th><th className="r" title={compact ? "Credit ước tính theo token" : "Credit ước tính theo token / số Kiro báo về"}>Credit</th>
        {!compact && <th>Tiết kiệm</th>}<th className="r">Độ trễ</th><th aria-label="Chi tiết" />
      </tr></thead>
      <tbody>
        {loading ? Array.from({ length: rowCount }, (_, i) => <tr key={i} className="placeholder-row">{Array.from({ length: columns }, (_, j) => <td key={j}><Skeleton /></td>)}</tr>) : rows.map(r => {
          const status = requestStatus(r), source = requestSource(r), tags = savingTags(r.optimizations, r.saved_tokens);
          return <tr key={r.id} data-i={r.id} tabIndex={0} aria-label={`Xem request ${r.id}`} onClick={() => onOpen(r.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); } }}>
            <td className="tm num">{fmtClock(r.started)}<small>{requestDate(r.started)}</small></td>
            <td className="nw" title={[clientLabel(r.client), agentLabel(r.agent)].filter(Boolean).join(" · ")}><span className="cell-brand"><Brand id={r.client} size={16} /><span>{clientLabel(r.client)}</span></span>{r.agent && <small className={"agent-tag" + (["main", "background", "subagent", "auto-mode"].includes(r.agent) ? "" : " named")}>{agentLabel(r.agent)}</small>}</td>
            {!compact && <td title={`${source.place} · ${source.ip}`}>{source.place}<small className="mono">{source.ip}</small></td>}
            <td className="mono nw" title={r.model + " · Qua " + providerLabel(r.provider)}><span className="cell-brand"><Brand id={modelBrand(r.model)} size={16} /><span>{r.model || "—"}</span></span></td>
            {!compact && <td className="nw" title={providerLabel(r.provider)}><span className="cell-brand"><Brand id={r.provider} size={16} /><span>{providerLabel(r.provider)}</span></span></td>}
            <td title={status.detail}><span className={`st ${status.tone}`}>{status.label}</span></td>
            <td className="r num" title={`${fmtInt(r.input_tokens)} / ${fmtInt(r.output_tokens)}`}>{fmtInt(r.input_tokens)} / {r.status === 0 ? "—" : fmtInt(r.output_tokens)}</td>
            <td className="r num">{r.status === 0 ? "—" : fmtCredit(r.estimated_credits)}{!compact && <> / {r.reported_credits === null ? "—" : fmtCredit(r.reported_credits)}</>}</td>
            {!compact && <td>{tags.length ? (
              <Tip className="saving-tags" content={<>
                <b className="tip-t">Gateway đã tiết kiệm</b>
                <ul>{savingDetails(r.optimizations).map(d => <li key={d}>{d}</li>)}</ul>
                {r.saved_tokens > 0 && <p className="tip-f">Tổng ≈ {fmtInt(r.saved_tokens)} token không phải gửi</p>}
              </>}>
                <span className={`tag${/^(clear|cache|compact|model|bỏ|local)/.test(tags[0]) ? " save" : ""}`}>{tags[0]}</span>
                {tags.length > 1 && <span className="tag more">+{tags.length - 1}</span>}
              </Tip>
            ) : "—"}</td>}
            <td className="r num">{r.status === 0 ? "—" : fmtMs(r.latency)}</td>{onStop && r.status === 0
              ? <td className="r"><button type="button" className="stop" aria-label="Dừng request" title="Dừng request" onClick={e => { e.stopPropagation(); onStop(r.id); }} onKeyDown={e => e.stopPropagation()}><ActionIcon name="stop" size={14} /></button></td>
              : <td className="r chev" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg></td>}
          </tr>;
        })}
        {!loading && rows.length < rowCount && <tr className="table-remainder" aria-hidden={rows.length ? true : undefined}><td colSpan={columns} style={{ height: `calc(var(--request-row-height) * ${rowCount - rows.length})` }}>{!rows.length && <span className="empty">Chưa có request trong kỳ này</span>}</td></tr>}
      </tbody>
    </table>
  </div>;
}
