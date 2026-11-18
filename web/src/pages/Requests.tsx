import ActionIcon from "../components/ActionIcon";
import type { ReactNode } from "react";
import { useToast } from "../hooks/useToast";
import Toast from "../components/Toast";
import Skeleton from "../components/Skeleton";
import ErrorCard from "../components/ErrorCard";
import Button from "../components/Button";
import { api } from "../api/client";
import { useEffect, useState } from "react";
import type {
  RequestList,
  ProvidersResponse,
} from "../../../src/dashboard/contract";
import { useApi } from "../hooks/useApi";
import { localDate, periodQuery, providersUrl, type PeriodValue } from "../lib/period";
import { fmtCompact, fmtInt } from "../lib/format";
import { providerLabel } from "../lib/brands";
import Seg from "../components/Seg";
import PeriodBar from "../components/PeriodBar";
import RequestTable from "../components/RequestTable";
import RequestDialog from "../components/RequestDialog";
import ConfirmClear from "../components/ConfirmClear";
import { stopRequest } from "../api/requests";
export default function Requests({ headerTools }: { headerTools: ReactNode }) {
  // Filters live in the URL, so a reload, Back or a shared link shows the same list.
  const initial = new URLSearchParams(location.search);
  const [period, setPeriod] = useState<PeriodValue>(() => ({
      period: (["day", "week", "month"] as const).find((p) => p === initial.get("period")) ?? "day",
      anchor: /^\d{4}-\d{2}-\d{2}$/.test(initial.get("anchor") ?? "") ? initial.get("anchor")! : localDate(),
    })),
    [search, setSearch] = useState(() => initial.get("q") ?? ""),
    [q, setQ] = useState(() => initial.get("q") ?? ""),
    [status, setStatus] = useState(() => ["success", "error", "active"].includes(initial.get("status") ?? "") ? initial.get("status")! : ""),
    [provider, setProvider] = useState(() => initial.get("provider") ?? ""),
    [page, setPage] = useState(() => Math.max(1, Math.floor(Number(initial.get("page")) || 1))),
    [pageSize, setPageSize] = useState(() => [10, 25, 50, 100].includes(Number(initial.get("size"))) ? Number(initial.get("size")) : 10),
    [revision, refresh] = useState(0),
    [clear, setClear] = useState(false),
    [toast, setToast] = useToast(),
    [selected, setSelected] = useState(() => {
      try {
        return decodeURIComponent(location.hash.slice(1));
      } catch {
        return "";
      }
    });
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q, search]);
  useEffect(() => {
    const url = new URLSearchParams();
    if (period.period !== "day") url.set("period", period.period);
    if (period.anchor !== localDate()) url.set("anchor", period.anchor);
    if (q) url.set("q", q);
    if (status) url.set("status", status);
    if (provider) url.set("provider", provider);
    if (page > 1) url.set("page", String(page));
    if (pageSize !== 10) url.set("size", String(pageSize));
    const search = url.toString();
    history.replaceState(null, "", location.pathname + (search ? "?" + search : "") + location.hash);
  }, [period, q, status, provider, page, pageSize]);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const params = new URLSearchParams(periodQuery(period));
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (provider) params.set("provider", provider);
  const { data, error, loading } = useApi<RequestList>(
    "/api/requests?" + params,
    revision,
  );
  // While requests are running, refresh quietly every 2 s so their status stays current.
  // Quiet = the current list is being reloaded by the timer (no loading fade).
  const query = params.toString();
  const [quietFor, setQuietFor] = useState("");
  const quiet = quietFor === query;
  const running = data?.items.some((r) => r.status === 0) ?? false;
  useEffect(() => {
    if (!running || loading || selected) return;
    const timer = setTimeout(() => {
      setQuietFor(query);
      refresh((n) => n + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [running, loading, selected, query]);
  const refetching = loading && !!data && !quiet;
  const providers = useApi<ProvidersResponse>(providersUrl());
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const summary = data?.summary;
  return (
    <section className="page requests">
      <div className="top">
        <div>
          <h1>Lịch sử</h1>
          <p className="lead">
            Bấm một request để xem nguồn gọi, payload, phản hồi và lỗi
          </p>
        </div>
        <div className="tools">
          <Button
            className="btn"
            loading={exporting}
            onClick={async () => {
              setExporting(true);
              setExportError("");
              try {
                const blob = await api<Blob>("/api/export?" + params, undefined, "blob");
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "tg-gateway-requests.csv";
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (e) {
                setExportError(e instanceof Error ? e.message : "Không thể xuất CSV.");
              } finally {
                setExporting(false);
              }
            }}
          >
            <ActionIcon name="download" />Xuất CSV
          </Button>
          <Button className="btn danger" onClick={() => setClear(true)}>
            Xóa log
          </Button>
          <Button
            className="btn icon"
            aria-label="Làm mới" rotate
            loading={loading && !quiet}
            onClick={() => {
              setQuietFor("");
              refresh((n) => n + 1);
            }}
          >
            <ActionIcon name="refresh" />
          </Button>
          {headerTools}
        </div>
      </div>
      <PeriodBar
        value={period}
        onChange={(v) => {
          setPeriod(v);
          setPage(1);
        }}
      />
      {providers.error && <ErrorCard message={providers.error} onRetry={providers.retry} />}
      {exportError && <p className="error" role="alert">{exportError}</p>}
      <Toast message={toast} />
      <div className={refetching ? "summary refetching" : "summary"}>
        {[
          ["Request", summary?.requests],
          ["Lỗi", summary?.failed],
          ["Credit Kiro báo cáo", summary?.reported_credits],
          ["Token tiết kiệm", summary?.saved_tokens],
        ].map(([label, value]) => (
          <article className="card" key={label}>
            <small>{label}</small>
            <b className={`num${!value ? "" : label === "Lỗi" ? " down" : label === "Token tiết kiệm" ? " up" : ""}`}>
              {loading && !data ? <Skeleton /> : typeof value === "number" ? fmtCompact(value) : "—"}
            </b>
          </article>
        ))}
      </div>
      <article className="card history-card">
        <div className="filters">
          <label className="search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="m11 11 3.5 3.5"/></svg>
            <input
              aria-label="Tìm request"
              placeholder="Agent, model, IP, mã lỗi"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <Seg
            label="Trạng thái"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              ["", "Tất cả"],
              ["success", "Thành công"],
              ["error", "Lỗi"],
              ["active", "Đang chạy"],
            ]}
          />
          <select
            className="btn"
            aria-label="Nhà cung cấp"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Mọi nhà cung cấp</option>
            {(
              providers.data?.providers.map((p) => p.id) ?? [
                "kiro",
                "anthropic",
                "openrouter",
                "deploy",
              ]
            ).map((id) => (
              <option key={id} value={id}>
                {providerLabel(id)}
              </option>
            ))}
          </select>
          <span className="count">
            {data ? fmtInt(data.total) + " request" : ""}
          </span>
        </div>

        {error && <ErrorCard message={error} onRetry={() => refresh(n => n + 1)} />}
        <div className={refetching ? "refetching" : ""}><RequestTable rows={data?.items ?? []} loading={loading && !data} rowCount={pageSize} onOpen={setSelected} onStop={async (id) => {
          try {
            await stopRequest(id);
            setToast("Đã dừng request");
          } catch (e) {
            setToast(e instanceof Error ? e.message : "Không thể dừng request.");
          }
          refresh((n) => n + 1);
        }} /></div>
        <div className="pager">
          <span>
            {data?.total
              ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, data.total)} trong ${fmtInt(data.total)}`
              : "0 request"}{" "}
            ·{" "}
            <select
              className="btn"
              aria-label="Số dòng mỗi trang"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / trang
                </option>
              ))}
            </select>
          </span>
          <div className="pages" role="navigation" aria-label="Phân trang">
            <Button
              className="page-button"
              disabled={page <= 1 || loading}
              aria-label="Trang trước"
              onClick={() => setPage((p) => p - 1)}
            >
              <ActionIcon name="chevron-left" />
            </Button>
            <span>
              {page} / {pages}
            </span>
            <Button
              className="page-button"
              disabled={page >= pages || loading}
              aria-label="Trang sau"
              onClick={() => setPage((p) => p + 1)}
            >
              <ActionIcon name="chevron-right" />
            </Button>
          </div>
        </div>
      </article>
      <div className="keep">
        <ActionIcon name="info" />
        <span>
          Xóa log chỉ xóa chi tiết từng request. Số tổng theo ngày, tuần, tháng
          được lưu riêng nên vẫn giữ nguyên.
        </span>
      </div>
      {selected && (
        <RequestDialog
          key={selected}
          id={selected}
          onFilter={(text) => {
            setSearch(text);
            setQ(text);
            setPage(1);
          }}
          onClose={() => {
            setSelected("");
            setQuietFor(query);
            refresh((n) => n + 1);
            history.replaceState(null, "", location.pathname + location.search);
          }}
        />
      )}
      {clear && (
        <ConfirmClear
          onClose={() => setClear(false)}
          onCleared={(n) => {
            setToast(`Đã xóa ${fmtInt(n)} request.`);
            setPage(1);
            refresh((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
