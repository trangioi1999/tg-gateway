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
        </div>
        <p className="note">
          Chỉ áp dụng cho đường Kiro. Request max_tokens = 1 luôn được trả lời
          tại chỗ.
        </p>
      </div>
    </>
  );
}
