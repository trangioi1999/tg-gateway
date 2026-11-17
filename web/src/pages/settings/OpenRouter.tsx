import Row from "../../components/Row";
import type { SectionProps } from "./types";
export default function OpenRouter({ secrets, providers }: SectionProps) {
  const provider = providers.find((p) => p.id === "openrouter");
  return (
    <div className="group">
      <h3>OpenRouter</h3>
      <div className="rows">
        <Row label="OPENROUTER_API_KEY" note="Đặt trong Cloudflare Secrets">
          <span
            className={"ok-dot" + (secrets.OPENROUTER_API_KEY ? "" : " miss")}
          >
            {secrets.OPENROUTER_API_KEY ? "Đã đặt" : "Chưa đặt"}
          </span>
        </Row>
        <Row label="Số dư tài khoản" note="Lấy từ OpenRouter khi có key">
          <span className="val num">
            {provider?.ok
              ? "$" + (provider.balanceUsd ?? 0).toLocaleString("vi-VN")
              : provider?.error === "not_configured" ? "Chưa kết nối" : "Không lấy được số liệu"}
          </span>
        </Row>
      </div>
    </div>
  );
}
