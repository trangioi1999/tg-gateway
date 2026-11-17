import Row from "../../components/Row";
import type { SectionProps } from "./types";
export default function ClaudeApi({
  draft,
  set,
  secrets,
  providers,
}: SectionProps) {
  const provider = providers.find((p) => p.id === "anthropic");
  return (
    <div className="group">
      <h3>Claude API (Anthropic)</h3>
      <div className="rows">
        <Row label="ANTHROPIC_API_KEY" note="Đặt trong Cloudflare Secrets">
          <span
            className={"ok-dot" + (secrets.ANTHROPIC_API_KEY ? "" : " miss")}
          >
            {secrets.ANTHROPIC_API_KEY ? "Đã đặt" : "Chưa đặt"}
          </span>
        </Row>
        <Row label="Chi phí tháng này" note="Tính theo usage trả về × bảng giá">
          <span className="val num">
            {provider?.ok
              ? "$" + (provider.monthCostUsd ?? 0).toLocaleString("vi-VN")
              : provider?.error === "not_configured" ? "Chưa kết nối" : "Không lấy được số liệu"}
          </span>
        </Row>
        <Row
          label="Hạn mức chi / tháng (USD)"
          note="Để theo dõi, không chặn request"
        >
          <input
            aria-label="Hạn mức chi / tháng (USD)"
            type="number"
            min={0}
            max={1e6}
            step="any"
            value={draft.anthropicMonthlyBudgetUsd}
            onChange={(e) =>
              set("anthropicMonthlyBudgetUsd", e.target.value === "" ? "" : Number(e.target.value))
            }
          />
        </Row>
      </div>
      <p className="note">
        Model có tiền tố anthropic/ đi thẳng tới Anthropic, không qua Kiro.
      </p>
    </div>
  );
}
