import { useToast } from "../../hooks/useToast";
import Toast from "../../components/Toast";
import { useState } from "react";
import Row from "../../components/Row";
import Seg from "../../components/Seg";
import ConfirmClear from "../../components/ConfirmClear";
import { fmtInt } from "../../lib/format";
import type { SectionProps } from "./types";
export default function Data({ draft, set, saved }: SectionProps) {
  const [clear, setClear] = useState(false),
    [message, setMessage] = useToast();
  return (
    <div className="group">
      <h3>Log chi tiết</h3>
      <div className="rows">
        <Row label="Lưu log chi tiết (ngày)">
          <input
            aria-label="Lưu log chi tiết (ngày)"
            type="number"
            min={1}
            max={365}
            value={draft.retentionDays}
            onChange={(e) => set("retentionDays", e.target.value === "" ? "" : Number(e.target.value))}
          />
        </Row>
        <Row
          label="Lưu payload & response"
          note={
            draft.capturePayloads === "off" && saved && saved.capturePayloads !== "off"
              ? "Lưu lại sẽ xóa toàn bộ payload đã lưu."
              : "Lưu nội dung prompt và câu trả lời (cắt ở 64 KB). Tắt mặc định vì chứa code và dữ liệu riêng tư."
          }
          stack
        >
          <Seg
            label="Lưu payload & response"
            value={draft.capturePayloads}
            onChange={(v) => set("capturePayloads", v)}
            options={[
              ["off", "Tắt"],
              ["errors", "Chỉ khi lỗi"],
              ["all", "Tất cả"],
            ]}
          />
        </Row>
        <Row label="Giữ payload trong (ngày)">
          <input
            aria-label="Giữ payload trong (ngày)"
            type="number"
            min={1}
            max={30}
            value={draft.payloadRetentionDays}
            onChange={(e) =>
              set("payloadRetentionDays", e.target.value === "" ? "" : Number(e.target.value))
            }
          />
        </Row>
        <Row label="Xóa lịch sử request">
          <button className="btn danger" onClick={() => setClear(true)}>
            Xóa log
          </button>
        </Row>
      </div>
      <p className="note">Thống kê theo ngày/tuần/tháng được giữ vĩnh viễn</p>
      <Toast message={message} />
      {clear && (
        <ConfirmClear
          onClose={() => setClear(false)}
          onCleared={(n) => setMessage(`Đã xóa ${fmtInt(n)} request.`)}
        />
      )}
    </div>
  );
}
