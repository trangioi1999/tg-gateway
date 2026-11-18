import type { ReactNode } from "react";
import Brand from "../components/Brand";
import Skeleton from "../components/Skeleton";
import OverviewSkeleton from "../components/OverviewSkeleton";
import ErrorCard from "../components/ErrorCard";
import Button from "../components/Button";
import { useEffect, useState } from "react";
import type {
  OverviewResponse,
  ProvidersResponse,
  RequestList,
} from "../../../src/dashboard/contract";
import { useApi } from "../hooks/useApi";
import { comparisonText, localDate, periodQuery, providersUrl, type PeriodValue } from "../lib/period";
import { fmtCompact, fmtCredit, fmtInt, fmtMs } from "../lib/format";
import PeriodBar from "../components/PeriodBar";
import { modelBrand, providerLabel } from "../lib/brands";
import QuotaCard from "../components/QuotaCard";
import Kpi from "../components/Kpi";
import Gauge from "../components/Gauge";
import Ring from "../components/Ring";
import RequestTable from "../components/RequestTable";
import RequestDialog from "../components/RequestDialog";
import { go } from "../router";
function selectedProvider() {
  const id = new URLSearchParams(location.search).get("provider") ?? "";
  return ["kiro", "anthropic", "openrouter", "deploy"].includes(id) ? id : "";
}
export default function Overview({ headerTools }: { headerTools: ReactNode }) {
  const [period, setPeriod] = useState<PeriodValue>({
      period: "day",
      anchor: localDate(),
    }),
    [provider, setProvider] = useState(selectedProvider),
    [selected, setSelected] = useState(""),
    [revision, refresh] = useState(0);
  useEffect(() => {
    const update = () => setProvider(selectedProvider());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const query = periodQuery(period) + (provider ? "&provider=" + provider : "");
  const { data, error, loading } = useApi<OverviewResponse>(
    "/api/overview?" + query,
    revision,
  );
  const providers = useApi<ProvidersResponse>(providersUrl(revision > 0), revision);
  const recent = useApi<RequestList>(
    "/api/requests?" + query + "&page=1&pageSize=10",
    revision,
  );
  const t = data?.totals,
    p = data?.previous;
  const success = t && t.requests ? (t.successful / t.requests) * 100 : 0,
    previousSuccess = p && p.requests ? (p.successful / p.requests) * 100 : 0;
  return (
    <section className="page overview">
      <div className="top">
        <div>
          <h1>
            {data ? `Xin chào, ${data.settings.displayName}` : "Tổng quan"}
          </h1>
          <p className="lead">
            {data
              ? data.settings.enabled
                ? "Chào mừng trở lại. Gateway đang chạy ổn định."
                : "Gateway đang tạm dừng."
              : "Thống kê hoạt động gateway."}
          </p>
        </div>
        <div className="tools"><Button
          className="btn icon"
          aria-label="Làm mới" rotate
            loading={loading || providers.loading || recent.loading}
          onClick={() => refresh((n) => n + 1)}
        >
          ↻
        </Button>{headerTools}</div>
      </div>
      <PeriodBar value={period} onChange={setPeriod} />
      <div className="ptabs" role="group" aria-label="Lọc theo nhà cung cấp">
        {providers.loading && !providers.data && (
          <Skeleton className="provider-placeholder" rows={3} />
        )}
        {providers.data?.providers.filter(p => p.configured).map(p => {
          const active = provider === p.id;
          const usage = !p.ok ? "—" : p.id === "kiro"
            ? `${fmtCompact(p.used ?? 0)} / ${fmtCompact(p.limit ?? 0)}`
            : `$${fmtCompact(p.balanceUsd ?? p.monthCostUsd ?? 0)}`;
          return (
            <button
              className="ptab"
              type="button"
              key={p.id}
              aria-pressed={active}
              onClick={() => go(active ? "/overview" : "/overview?provider=" + p.id)}
            >
              <Brand id={p.id} size={20} />
              {providerLabel(p.id)}
              <small>{usage}</small>
            </button>
          );
        })}
      </div>
      {providers.error && <ErrorCard message={providers.error} onRetry={providers.retry} />}
      {loading && !data && <OverviewSkeleton />}
      {error && <ErrorCard message={error} onRetry={() => refresh(n => n + 1)} />}
      {data && t && p && (
        <div key={query} className={loading ? "overview-content section-enter refetching" : "overview-content section-enter"}>
          <div className="quota">
            <QuotaCard
              id={provider || (providers.data?.providers.some(p => p.id === "kiro" && p.configured) ? "kiro" : "")}
              provider={providers.data?.providers.find(
                (p) => p.id === (provider || "kiro") && p.configured,
              )}
              month={data.month}
              budget={data.settings.monthlyCreditBudget}
            />
            <div className="kpis">
              <Kpi
                comparison={comparisonText(period)}
                label="Request"
                note={`trễ TB ${fmtMs(t.avg_latency)}`}
                value={fmtInt(t.requests)}
                current={t.requests}
                previous={p.requests}
              />
              <Kpi
                comparison={comparisonText(period)}
                label="Token"
                note={`vào ${fmtCompact(t.input_tokens)} · ra ${fmtCompact(t.output_tokens)}`}
                value={fmtCompact(t.input_tokens + t.output_tokens)}
                current={t.input_tokens + t.output_tokens}
                previous={p.input_tokens + p.output_tokens}
              />
              {provider && provider !== "kiro" ? (
                <Kpi
                  comparison={comparisonText(period)}
                  label="Chi phí"
                  better="down"
                  value={"$" + fmtCredit(t.cost_usd)}
                  current={t.cost_usd}
                  previous={p.cost_usd}
                />
              ) : (
                <Kpi
                  comparison={comparisonText(period)}
                  label="Credit Kiro"
                  better="down"
                  note={t.requests ? `TB ${fmtCredit(t.reported_credits / Math.max(1, t.reported_requests))}/request` : undefined}
                  value={fmtCredit(t.reported_credits)}
                  current={t.reported_credits}
                  previous={p.reported_credits}
                />
              )}
              <Kpi
                comparison={comparisonText(period)}
                label="Tỷ lệ thành công"
                value={
                  success.toLocaleString("vi-VN", {
                    maximumFractionDigits: 1,
                  }) + "%"
                }
                current={success}
                previous={previousSuccess}
              />
            </div>
          </div>
          <div className="row3">
            <article className="card">
              <div className="head">
                <div>
                  <h2>Ngân sách tháng</h2>
                  <p className="sub">Credit quy đổi nội bộ</p>
                </div>
              </div>
              <Gauge
                used={data.month.estimated_credits}
                limit={data.settings.monthlyCreditBudget}
              />
            </article>
            <article className="card">
              <div className="head">
                <div>
                  <h2>Tiết kiệm credit</h2>
                  <p className="sub">Clear tool result · Compact · Cache</p>
                </div>
              </div>
              <div className="savings">
                <div>
                  <div className="stat">
                    <small>Token đã cắt bớt</small>
                    <b>{fmtCompact(t.saved_tokens)}</b>
                  </div>
                  <div className="stat">
                    <small>Trả lời từ cache</small>
                    <b>{fmtInt(t.cache_hits)} request</b>
                  </div>
                </div>
                <Ring
                  value={
                    t.saved_tokens + t.input_tokens
                      ? t.saved_tokens / (t.saved_tokens + t.input_tokens)
                      : 0
                  }
                />
              </div>
            </article>
            <article className="card">
              <div className="head">
                <div>
                  <h2>Model đang dùng</h2>
                  <p className="sub">Phân bổ request</p>
                </div>
              </div>
              <div className="list">
                {data.models.map((m) => (
                  <div className="li" key={m.provider + m.model}>
                    <span className="nm"><Brand id={modelBrand(m.model)} size={18} /><span title={m.model}>{m.model}</span></span>
                    <span className="n">{fmtInt(m.requests)}</span>
                    <div className="bar">
                      <span
                        style={{
                          width: `${t.requests ? (m.requests / t.requests) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                {!data.models.length && (
                  <p className="empty">Chưa có dữ liệu model.</p>
                )}
              </div>
            </article>
          </div>
        </div>
      )}
      <article className="card recent-card">
        <div className="head">
          <div>
            <h2>Request gần đây</h2>
            <p className="sub">Bấm một dòng để xem chi tiết</p>
          </div>
          <a
            href="/requests"
            onClick={(e) => {
              e.preventDefault();
              go("/requests");
            }}
          >
            Xem tất cả lịch sử →
          </a>
        </div>

        {recent.error && <ErrorCard message={recent.error} onRetry={recent.retry} />}
        <RequestTable rows={recent.data?.items.slice(0, 5) ?? []} loading={recent.loading && !recent.data} rowCount={5} compact onOpen={setSelected} />

      </article>
      {selected && (
        <RequestDialog
          key={selected}
          id={selected}
          onClose={() => setSelected("")}
        />
      )}
    </section>
  );
}
