import type { ReactNode } from "react";
import Brand from "../components/Brand";
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
import { fmtCompact, fmtInt, fmtMs } from "../lib/format";
import PeriodBar from "../components/PeriodBar";
import { providerLabel } from "../lib/brands";
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
      period: "week",
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
      <div className="period-row">
        <PeriodBar value={period} onChange={setPeriod} />
        {provider && <button className="btn provider-chip" onClick={() => go("/overview")} aria-label={`Bỏ lọc ${providerLabel(provider)}`}><Brand id={provider} size={16} />{providerLabel(provider)} <span aria-hidden="true">×</span></button>}
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
                value={fmtInt(t.requests)}
                current={t.requests}
                previous={p.requests}
              />
              <Kpi
                comparison={comparisonText(period)}
                label="Token"
                value={fmtCompact(t.input_tokens + t.output_tokens)}
                current={t.input_tokens + t.output_tokens}
                previous={p.input_tokens + p.output_tokens}
              />
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
              <Kpi
                comparison={comparisonText(period)}
                label="Độ trễ TB"
                better="down"
                value={fmtMs(t.avg_latency)}
                current={t.avg_latency}
                previous={p.avg_latency}
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
                    <span className="nm"><Brand id={m.provider} size={18} />{m.model}</span>
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
