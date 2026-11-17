import Row from "../../components/Row";
import Switch from "../../components/Switch";
import type { SectionProps } from "./types";
export default function General({ draft, set }: SectionProps) {
  return (
    <div className="group">
      <h3>Gateway</h3>
      <div className="rows">
        <Row label="Tên hiển thị">
          <input
            aria-label="Tên hiển thị"
            type="text"
            maxLength={40}
            value={draft.displayName}
            onChange={(e) => set("displayName", e.target.value)}
          />
        </Row>
        <Row
          label="Nhận request"
          note="Tắt để tạm dừng API. Dashboard vẫn hoạt động."
        >
          <Switch
            label="Nhận request"
            value={draft.enabled}
            onChange={(v) => set("enabled", v)}
          />
        </Row>
        <Row label="Request / phút">
          <input
            aria-label="Request / phút"
            type="number"
            min={1}
            max={1000}
            value={draft.requestsPerMinute}
            onChange={(e) => set("requestsPerMinute", e.target.value === "" ? "" : Number(e.target.value))}
          />
        </Row>
        <Row
          label="Timeout khi im lặng"
          note="Chỉ cắt khi upstream không gửi gì (giây)"
        >
          <input
            aria-label="Timeout khi im lặng"
            type="number"
            min={10}
            max={600}
            value={draft.timeoutSeconds}
            onChange={(e) => set("timeoutSeconds", e.target.value === "" ? "" : Number(e.target.value))}
          />
        </Row>
        <Row
          label="Model ID"
          note="Mỗi dòng một model. Không tiền tố = Kiro, anthropic/ = Claude API, openrouter/ = OpenRouter"
          stack
        >
          <textarea
            aria-label="Model ID"
            rows={5}
            value={draft.models.join("\n")}
            onChange={(e) => set("models", e.target.value.split("\n"))}
          />
        </Row>
      </div>
    </div>
  );
}
