import Skeleton from "./Skeleton";
import ErrorCard from "./ErrorCard";
import { useDialogClose } from "../hooks/useDialogClose";
import { useEffect, useRef, useState } from "react";
import type { RequestDetail } from "../../../src/dashboard/contract";
import { api } from "../api/client";
import { clientLabel, providerLabel } from "../lib/brands";
import { fmtClock, fmtCompact, fmtMs } from "../lib/format";
import Seg from "./Seg";
import Stepper from "./Stepper";
import CodeBox from "./CodeBox";
type Tab = "overview" | "request" | "response" | "error";
const hints: Record<string, string> = {
  kiro_http_530: "Đổi API region trong Cài đặt → Kiro.",
  rate_limit: "Đợi một lúc hoặc tăng hạn mức request.",
  upstream_http_429: "Đợi một lúc hoặc tăng hạn mức nhà cung cấp.",
  kiro_auth_failed: "Tải lại token Kiro trong Cài đặt → Kiro.",
};
export default function RequestDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { closing, close } = useDialogClose(onClose);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ref = useRef<HTMLDialogElement>(null),
    [data, setData] = useState<RequestDetail>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [tab, setTab] = useState<Tab>("overview"),
    [revision, retry] = useState(0);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    titleRef.current?.focus();
    return () => d?.close();
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let first = true;
    setError("");
    async function load() {
      if (first) setLoading(true);
      try {
        const result = await api<RequestDetail>(
          "/api/requests/" + encodeURIComponent(id),
          { signal: controller.signal },
        );
        if (stopped) return;
        setData(result);
        setError("");
        if (first) {
          setTab(result.request.status >= 400 ? "error" : "overview");
          first = false;
        }
        if (result.request.status === 0) timer = setTimeout(load, 2000);
      } catch (e) {
        if (!stopped)
          setError(e instanceof Error ? e.message : "Không thể tải request.");
      } finally { if (!stopped) setLoading(false); }
    }
    void load();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, revision]);
  const r = data?.request;
  const noPayload = (
    <p className="keep">
      Bật "Lưu payload &amp; response" trong Cài đặt → Dữ liệu &amp; log để xem
      nội dung.
    </p>
  );
  return (
    <dialog className={closing ? "dialog-closing" : ""}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="request-title"
    >
      <div className="sheet">
        <div className="sh-head">
          <div>
            <h2 id="request-title" ref={titleRef} tabIndex={-1}>
              {r ? `${clientLabel(r.client)} → ${r.model}` : "Chi tiết request"}
            </h2>
            {r?.status === 0 && !error && <span className="updating" role="status">Đang cập nhật</span>}
            {r && (
              <div className="meta">
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
                <span>
                  {fmtClock(r.started)} · {fmtMs(r.latency)}
                </span>
              </div>
            )}
          </div>
          <button className="close" aria-label="Đóng" onClick={close}>
            ✕
          </button>
        </div>
        <div className="sh-tabs">
          <Seg
            label="Chi tiết request"
            value={tab}
            onChange={setTab}
            options={[
              ["overview", "Tổng quan"],
              ["request", "Request"],
              ["response", "Response"],
              ["error", "Lỗi"],
            ]}
          />
        </div>
        <div className={`sh-body section-enter${loading && data ? " refetching" : ""}`} key={tab}>
          {error && <ErrorCard message={error} onRetry={() => retry(n => n + 1)} />}
          {!data && !error && <><Skeleton className="skeleton-info" rows={8} /><Skeleton className="skeleton-stepper" rows={4} /></>}
          {data && r && (
            <>
              {tab === "overview" && (
                <>
                  <div className="kv">
                    {[
                      [
                        "Máy gọi",
                        `${clientLabel(r.client)} · ${r.user_agent ?? "—"}`,
                      ],
                      ["IP nguồn", r.ip ?? "—"],
                      [
                        "Vị trí",
                        `${[r.city, r.country].filter(Boolean).join(", ") || "—"} · Cloudflare ${r.colo ?? "—"}`,
                      ],
                      ["Nhà cung cấp", providerLabel(r.provider)],
                      ["Model", r.model],
                      [
                        "Input / output",
                        `${fmtCompact(r.input_tokens)} / ${fmtCompact(r.output_tokens)}`,
                      ],
                      [
                        "Credit",
                        `${fmtCompact(r.estimated_credits)} quy đổi / ${r.reported_credits === null ? "—" : fmtCompact(r.reported_credits)} báo cáo`,
                      ],
                      ["Request ID", r.id],
                      ["Endpoint", r.endpoint],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <small>{k}</small>
                        <span>{v}</span>
                      </div>
                    ))}
                  </div>
                  <Stepper
                    steps={data.steps}
                    started={r.started}
                    provider={r.provider}
                  />
                </>
              )}
              {(tab === "request" || tab === "response") && (
                <>
                  {data.payload?.truncated && (
                    <p className="keep">
                      Nội dung đã được cắt ở giới hạn 64 KB.
                    </p>
                  )}
                  {data.payload?.[tab] !== null &&
                  data.payload?.[tab] !== undefined ? (
                    <CodeBox
                      name={
                        tab === "request"
                          ? "request.json"
                          : r.streamed
                            ? "response.sse"
                            : "response.json"
                      }
                      text={data.payload[tab]!}
                      sse={tab === "response" && !!r.streamed}
                    />
                  ) : (
                    noPayload
                  )}
                </>
              )}
              {tab === "error" &&
                (r.status >= 400 ? (
                  <>
                    <div className="errbox">
                      <b>{r.error_code ?? `HTTP ${r.status}`}</b>
                      <span>
                        {r.error_message ?? "Không có thông tin lỗi."}
                      </span>
                      {r.error_code && hints[r.error_code] && (
                        <p>{hints[r.error_code]}</p>
                      )}
                    </div>
                    {data.payload?.response && (
                      <CodeBox name={r.streamed ? "error.sse" : "error.json"} sse={!!r.streamed} text={data.payload.response} />
                    )}
                  </>
                ) : (
                  <p className="empty">Request không có lỗi.</p>
                ))}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
