import ActionIcon from "./ActionIcon";
import { presentStep, stepDuration } from "../lib/steps";
import type { Step, ProviderId } from "../../../src/dashboard/contract";
import { fmtClock } from "../lib/format";
import { providerLabel } from "../lib/brands";
export default function Stepper({
  steps,
  started,
  provider,
}: {
  steps: Step[];
  started: number;
  provider: ProviderId;
}) {
  const total = Math.max(1, ...steps.map((s) => (s.at ?? 0) + (s.dur ?? 0)));
  const labels = {
    received: "Nhận request",
    auth: "Xác thực API key",
    optimize: "Tiết kiệm credit",
    cache: "Trả lời từ cache",
    local: "Trả lời tại chỗ",
    upstream: "Gửi tới " + providerLabel(provider),
    stream: "Nhận stream",
    done: "Hoàn tất",
    error: "Kết thúc với lỗi",
  };
  return (
    <div>
      <div className="sec-t">
        <h3>Các bước xử lý</h3>
      </div>
      <ol className="stepper">
        <li className="row hd">
          <span>Thời điểm</span>
          <span />
          <span>Bước</span>
          <span>Thời lượng</span>
        </li>
        {steps.map(presentStep).map((s, index) => (
          <li className={"row " + s.state} key={s.key}>
            <time className="ts">
              {s.at === null ? "—" : fmtClock(started + s.at)}
            </time>
            <span className="ic" role="img" aria-label={{ done: "Hoàn tất", active: "Đang chạy", error: "Lỗi", skip: "Bỏ qua", pending: "Chưa tới" }[s.state]}>
              {s.state === "active"
                ? ""
                : s.state === "done"
                  ? <ActionIcon name="check" size={14} />
                  : s.state === "error"
                    ? <ActionIcon name="x" size={14} />
                    : s.state === "pending" ? index + 1 : "–"}
            </span>
            <div className="bd">
              <b>
                {s.key === "stream" && s.state === "active"
                  ? "Đang nhận stream"
                  : labels[s.key]}
              </b>
              <small>{s.detail}</small>
            </div>
            <div className="du">
              <span>{stepDuration(s)}</span>
              <div className="wf">
                {s.at !== null && (
                  <i
                    style={{
                      left: `${(s.at / total) * 100}%`,
                      width: `${((s.dur ?? 0) / total) * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
