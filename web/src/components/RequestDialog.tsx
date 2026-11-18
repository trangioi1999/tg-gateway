import Skeleton from "./Skeleton";
import { agentLabel, requestStatus } from "../lib/requestPresentation";
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
import LiveLog from "./LiveLog";
import ContextBars, { parseContext } from "./ContextBars";
import Button from "./Button";
import { stopRequest } from "../api/requests";
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
  onFilter,
}: {
  id: string;
  onClose: () => void;
  /** Show the history filtered by this text (e.g. a session ID). */
  onFilter?: (q: string) => void;
}) {
  const { closing, close } = useDialogClose(onClose);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const ref = useRef<HTMLDialogElement>(null),
    [data, setData] = useState<RequestDetail>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [tab, setTab] = useState<Tab>("overview"),
    [revision, retry] = useState(0),
    [live, setLive] = useState(""),
    [liveBytes, setLiveBytes] = useState(0),
    [stopping, setStopping] = useState(false),
    [stopError, setStopError] = useState("");
  /** Characters of live output already received (sent as `since`). */
  const liveTotal = useRef(0);
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
          "/api/requests/" + encodeURIComponent(id) + "?since=" + liveTotal.current,
          { signal: controller.signal },
        );
        if (stopped) return;
        setData(result);
        const l = result.live;
        if (l) {
          // A gap means the start scrolled out of the server's buffer.
          const gap = l.from > liveTotal.current;
          if (l.text || gap) setLive((prev) => (gap ? "…" : prev) + l.text);
          liveTotal.current = l.total;
          setLiveBytes(l.bytes);
        }
        setError("");
        if (first) {
          setTab(result.request.status >= 400 ? "error" : "overview");
          first = false;
        }
        if (result.request.status === 0) timer = setTimeout(load, 1000);
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
      <div className="sheet request-sheet">
        <div className="sh-head">
          <div>
            <h2 id="request-title" ref={titleRef} tabIndex={-1}>
              {r ? `${clientLabel(r.client)} → ${r.model || "—"}` : "Chi tiết request"}
            </h2>
            {r?.status === 0 && !error && <span className="updating" role="status">Đang cập nhật</span>}
            {r && (
              <div className="meta">
                <span className={`st ${requestStatus(r).tone}`}>{requestStatus(r).label}</span>
                <span>
                  {fmtClock(r.started)} · {fmtMs(r.latency)}
                </span>
              </div>
            )}
          </div>
          <div className="sh-acts">
            {r?.status === 0 && (
              <Button
                className="btn danger"
                loading={stopping}
                onClick={async () => {
                  setStopping(true);
                  setStopError("");
                  try {
                    await stopRequest(id);
                    retry((n) => n + 1);
                  } catch (e) {
                    setStopError(e instanceof Error ? e.message : "Không thể dừng request.");
                  } finally {
                    setStopping(false);
                  }
                }}
              >
                ■ Dừng
              </Button>
            )}
            <button className="close" aria-label="Đóng" onClick={close}>
              ✕
            </button>
          </div>
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
          {stopError && <p className="error" role="alert">{stopError}</p>}
          {!data && !error && <><Skeleton className="skeleton-info" rows={8} /><Skeleton className="skeleton-stepper" rows={4} /></>}
          {data && r && (
            <>
              {tab === "overview" && (
                <>
                  {r.status === 0 && (
                    <LiveLog text={live} bytes={liveBytes} running />
                  )}
                  <div className="kv">
                    {[
                      [
                        "Máy gọi",
                        `${clientLabel(r.client)} · ${r.user_agent ?? "—"}`,
                      ],
                      ["Agent", agentLabel(r.agent) || "—"],
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
                    {(
                      [
                        ["Phiên Claude Code", r.claude_session, "Tên file lịch sử của phiên trong ~/.claude/projects/<dự án>/"],
                        ["Kiro conversationId", r.kiro_conversation, "ID hội thoại gateway gửi cho Kiro"],
                      ] as const
                    ).map(([k, v, hint]) => (
                      <div key={k} title={hint}>
                        <small>{k}</small>
                        <span className="mono id-line">
                          {v ?? "—"}
                          {v && onFilter && (
                            <button type="button" className="ib" onClick={() => { onFilter(v); close(); }}>
                              Xem cùng ID
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  {parseContext(r.context) && <ContextBars sizes={parseContext(r.context)!} />}
                  {r.status !== 0 && live && (
                    <LiveLog text={live} bytes={liveBytes} running={false} />
                  )}
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
