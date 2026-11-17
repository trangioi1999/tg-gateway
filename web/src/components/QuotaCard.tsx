import type { ProviderQuota, Totals } from "../../../src/dashboard/contract";
import { fmtCompact } from "../lib/format";
import { providerLabel } from "../lib/brands";
import Brand from "./Brand";
export default function QuotaCard({
  provider,
  id,
  month,
  budget,
}: {
  provider?: ProviderQuota;
  id: string;
  month: Totals;
  budget: number;
}) {
  const used =
    id === "kiro"
      ? provider?.used
      : id === "anthropic" || id === "deploy"
        ? provider?.monthCostUsd
        : month.estimated_credits;
  const limit =
    id === "kiro"
      ? provider?.limit
      : id === "anthropic"
        ? provider?.budgetUsd
        : budget;
  const missing = !!id && (!provider || !provider.ok);
  return (
    <article className="card qcard">
      <div className="qh">
        <b>
          {id && <Brand id={id} />}{" "}
          {id ? providerLabel(id) : "Credit tháng này"}
        </b>
        {provider?.plan && <span className="pill">{provider.plan}</span>}
      </div>
      {missing ? (
        <>
          <p role="status">{provider?.error === "not_configured" ? "Chưa kết nối" : "Không lấy được số liệu"}</p>
          <p className="sub">
            {fmtCompact(month.reported_credits)} credit báo cáo từ thống kê
          </p>
        </>
      ) : id === "openrouter" ? (
        <div className="big">
          ${fmtCompact(provider?.balanceUsd ?? 0)} <span>số dư</span>
        </div>
      ) : (
        <>
          <div className="big">
            {id === "anthropic" || id === "deploy" ? "$" : ""}
            {fmtCompact(used ?? 0)}{" "}
            <span>
              / {limit ? fmtCompact(limit) : "—"}{" "}
              {id === "kiro" || !id ? "credit" : "USD"}
            </span>
          </div>
          <div className="track">
            <span
              style={{
                width: `${limit ? Math.min(100, ((used ?? 0) / limit) * 100) : 0}%`,
              }}
            />
          </div>
          <div className="kf">
            <span>
              {limit
                ? `Còn ${fmtCompact(Math.max(0, limit - (used ?? 0)))}`
                : "Chưa đặt mục tiêu"}
            </span>
            {provider?.resetAt && (
              <span>
                Đặt lại {new Date(provider.resetAt).toLocaleDateString("vi-VN")}
              </span>
            )}
          </div>
        </>
      )}
      <div className="src">
        {id ? "Số liệu nhà cung cấp" : "Credit quy đổi nội bộ · tháng hiện tại"}
      </div>
    </article>
  );
}
