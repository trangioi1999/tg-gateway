import Row from "../../components/Row";
import Switch from "../../components/Switch";
import type { SectionProps, NumericSetting } from "./types";
export default function Saving({ draft, set }: SectionProps) {
  const number = (
    key: NumericSetting,
    label: string,
    min: number,
    max: number,
  ) => (
    <Row key={key} label={label}>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value === "" ? "" : Number(e.target.value))}
      />
    </Row>
  );
  return (
    <>
      <div className="group">
        <h3>Tool result cũ</h3>
        <div className="rows">
          <Row
            label="Xóa tool result cũ"
            note="Thay output tool cũ bằng ghi chú khi prompt vượt ngưỡng"
          >
            <Switch
              label="Xóa tool result cũ"
              value={draft.clearToolResults}
              onChange={(v) => set("clearToolResults", v)}
            />
          </Row>
          {number("clearTriggerTokens", "Ngưỡng xóa (token)", 1000, 2000000)}
          {number("clearKeepToolUses", "Giữ lần gọi tool gần nhất", 0, 100)}
          <Row
            label="Rút gọn tham số tool cũ"
            note="Chuỗi dài hơn 300 ký tự được thay bằng ghi chú"
          >
            <Switch
              label="Rút gọn tham số tool cũ"
              value={draft.clearToolInputs}
              onChange={(v) => set("clearToolInputs", v)}
            />
          </Row>
        </div>
      </div>
      <div className="group">
        <h3>Định nghĩa tool</h3>
        <div className="rows">
          <Row
            label="Chỉ gửi các tool"
            note="Mỗi dòng một tên, * là ký tự đại diện (vd. mcp__github__*). Để trống = gửi tất cả. Tool không có trong danh sách thì model không thấy và không gọi được."
            stack
          >
            <textarea
              aria-label="Chỉ gửi các tool"
              rows={5}
              placeholder={"(trống = gửi tất cả) ví dụ:\nRead\nEdit\nWrite\nBash\nGrep\nGlob\nAgent"}
              value={draft.toolAllowlist.join("\n")}
              onChange={(e) => set("toolAllowlist", e.target.value.split("\n"))}
            />
          </Row>
          <Row
            label="Không gửi các tool"
            note="Áp dụng sau danh sách trên, ví dụ NotebookEdit, WebSearch."
            stack
          >
            <textarea
              aria-label="Không gửi các tool"
              rows={3}
              value={draft.toolDenylist.join("\n")}
              onChange={(e) => set("toolDenylist", e.target.value.split("\n"))}
            />
          </Row>
        </div>
        <p className="note">
          Mở một request trong Lịch sử → "Context gửi lên Kiro" để xem số token của từng tool.
        </p>
      </div>
      <div className="group">
        <h3>Compact &amp; cache</h3>
        <div className="rows">
          <Row
            label="Compact hội thoại dài"
            note="Tóm tắt phần đầu bằng model rẻ, lưu tối đa 7 ngày"
          >
            <Switch
              label="Compact hội thoại dài"
              value={draft.compactEnabled}
              onChange={(v) => set("compactEnabled", v)}
            />
          </Row>
          {number(
            "compactTriggerTokens",
            "Ngưỡng compact (token)",
            10000,
            2000000,
          )}
          {number(
            "compactKeepTokens",
            "Token giữ lại sau compact",
            1000,
            1000000,
          )}
          <Row label="Model tóm tắt">
            <input
              type="text"
              aria-label="Model tóm tắt"
              value={draft.compactModel}
              onChange={(e) => set("compactModel", e.target.value)}
            />
          </Row>
          {number("responseCacheSeconds", "Cache câu trả lời (giây)", 0, 3600)}
          <Row
            label="Model cho bộ phân loại auto mode"
            note="Claude Code gửi thêm 1 request kiểm tra an toàn cho mỗi tool call ở auto mode. Để trống = dùng model của client. Chỉ áp dụng khi model đã bật."
          >
            <input
              type="text"
              aria-label="Model cho bộ phân loại auto mode"
              placeholder="claude-sonnet-5.5"
              value={draft.autoModeModel}
              onChange={(e) => set("autoModeModel", e.target.value.trim())}
            />
          </Row>
        </div>
        <p className="note">
          Chỉ áp dụng cho đường Kiro. Request max_tokens = 1 luôn được trả lời
          tại chỗ.
        </p>
      </div>
      <div className="group">
        <h3>Thử nghiệm</h3>
        <div className="rows">
          <Row
            label="Giữ conversationId theo phiên"
            note="Dùng một conversationId Kiro cho cả một mạch hội thoại (phiên chính, mỗi subagent riêng) thay vì ID mới mỗi request. Bật để đo xem Kiro có tính credit ít hơn không; Claude Code vẫn gửi đủ lịch sử."
          >
            <Switch
              label="Giữ conversationId theo phiên"
              value={draft.stableConversationId}
              onChange={(v) => set("stableConversationId", v)}
            />
          </Row>
        </div>
      </div>
    </>
  );
}
