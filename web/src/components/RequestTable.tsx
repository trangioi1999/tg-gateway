import type { RequestRow } from "../../../src/dashboard/contract";
import { fmtClock, fmtCompact, fmtMs } from "../lib/format";
import { clientLabel, providerLabel } from "../lib/brands";
import Brand from "./Brand";
export default function RequestTable({
  rows,
  compact = false,
  onOpen,
}: {
  rows: RequestRow[];
  compact?: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Agent</th>
            {!compact && <th>Nguồn</th>}
            <th>Model</th>
            <th>Trạng thái</th>
            <th className="r">Input / output</th>
            <th className="r">{compact ? "Credit" : "Quy đổi / Kiro"}</th>
            {!compact && <th>Tiết kiệm</th>}
            <th className="r">Độ trễ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-i={r.id} onClick={() => onOpen(r.id)}>
              <td className="tm">
                {fmtClock(r.started)}
                <small>{new Date(r.started).toLocaleDateString("vi-VN")}</small>
              </td>
              <td className="nw">
                <Brand id={r.client} size={16} /> {clientLabel(r.client)}
              </td>
              {!compact && (
                <td>
                  {r.ip ?? "—"}
                  <small>
                    {[r.city, r.country].filter(Boolean).join(", ") || "—"}
                  </small>
                </td>
              )}
              <td className="mono">
                {r.model || "—"}
                <small>{providerLabel(r.provider)}</small>
              </td>
              <td>
                <span
                  className={
                    "st " +
                    (r.status === 0 ? "run" : r.status >= 400 ? "err" : "ok")
                  }
                >
                  {r.status === 0
                    ? "Đang chạy"
                    : r.status >= 400
                      ? "Lỗi " + r.status
                      : "Thành công"}
                </span>
              </td>
              <td className="r num">
                {fmtCompact(r.input_tokens)} / {fmtCompact(r.output_tokens)}
              </td>
              <td className="r num">
                {fmtCompact(r.estimated_credits)}
                {!compact && (
                  <small>
                    {r.reported_credits === null
                      ? "—"
                      : fmtCompact(r.reported_credits)}
                  </small>
                )}
              </td>
              {!compact && (
                <td>
                  {r.saved_tokens > 0 && (
                    <span className="tag save">
                      −{fmtCompact(r.saved_tokens)} token
                    </span>
                  )}
                  {r.optimizations && <small>{r.optimizations}</small>}
                </td>
              )}
              <td className="r nw">{fmtMs(r.latency)}</td>
              <td>
                <button
                  className="ib"
                  aria-label={`Xem request ${r.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(r.id);
                  }}
                >
                  ›
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={compact ? 8 : 10}>
                Chưa có request trong kỳ này.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
