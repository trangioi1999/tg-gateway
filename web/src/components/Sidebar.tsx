import type { ProvidersResponse } from "../../../src/dashboard/contract";
import { useApi } from "../hooks/useApi";
import { providersUrl } from "../lib/period";
import Brand from "./Brand";
import { providerLabel } from "../lib/brands";
import { fmtCompact } from "../lib/format";
import Logo from "./Logo";
import Skeleton from "./Skeleton";
import ErrorCard from "./ErrorCard";
import Button from "./Button";
import { useRoute } from "../router";
import { api } from "../api/client";
import { useState } from "react";
export default function Sidebar() {
  const { path, go } = useRoute();
  const provider = new URLSearchParams(location.search).get("provider");
  const providers = useApi<ProvidersResponse>(providersUrl());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <aside className="side">
      <div className="brand">
        <Logo />
        TG Gateway
      </div>
      <nav className="nav" aria-label="Điều hướng">
        <span className="lbl">Workspace</span>
        {(
          [
            ["/overview", "Tổng quan"],
            ["/requests", "Lịch sử"],
            ["/settings", "Cài đặt"],
          ] as const
        ).map(([p, label]) => (
          <a
            key={p}
            href={p}
            aria-current={path === p && !(p === "/overview" && provider) ? "page" : undefined}
            onClick={(e) => {
              if (!e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                go(p);
              }
            }}
          >
            {label}
          </a>
        ))}
        {providers.data?.providers.some(p => p.configured) && <span className="lbl">Nhà cung cấp</span>}
        {providers.data?.providers
          .filter((p) => p.configured)
          .map((p) => (
            <a
              className={providers.loading ? "refetching" : ""}
              aria-current={path === "/overview" && provider === p.id ? "page" : undefined}
              key={p.id}
              href={"/overview?provider=" + p.id}
              onClick={(e) => {
                e.preventDefault();
                go("/overview?provider=" + p.id);
              }}
            >
              <Brand id={p.id} size={18} />
              {providerLabel(p.id)}
              <small>
                {p.error === "not_configured" ? "Chưa kết nối" : !p.ok
                  ? "—"
                  : p.id === "kiro"
                    ? `${fmtCompact(p.used ?? 0)}/${fmtCompact(p.limit ?? 0)}`
                    : `$${fmtCompact(p.balanceUsd ?? p.monthCostUsd ?? 0)}`}
              </small>
            </a>
          ))}
        {providers.loading && !providers.data && <Skeleton rows={4} />}
        {providers.error && <ErrorCard message={providers.error} onRetry={providers.retry} />}
      </nav>
      <div className="side-foot">
        <Button loading={busy}
          className="btn full"
          onClick={() => {
            setBusy(true);
            void api("/api/session", { method: "DELETE" })
              .then(() => go("/login", { replace: true }))
              .catch((e) => setError(e.message)).finally(() => setBusy(false));
          }}
        >
          Đăng xuất
        </Button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
