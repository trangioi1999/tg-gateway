import ActionIcon, { type IconName } from "./ActionIcon";
import Logo from "./Logo";
import Button from "./Button";
import { useRoute } from "../router";
import { api } from "../api/client";
import { useEffect, useState } from "react";
import type { ProvidersResponse } from "../../../src/dashboard/contract";
import { useApi } from "../hooks/useApi";
import { providersUrl } from "../lib/period";
import Brand from "./Brand";
import { currentSection, providerSections, sectionPath, visibleSections } from "../lib/settingsSections";
import { BUILD, buildDetail, buildLabel } from "../build";
import { useNewBuild } from "../hooks/useNewBuild";
export default function Sidebar() {
  const { path, go } = useRoute();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = useNewBuild();
  // Settings sections are sub-items of "Cài đặt"; provider ones only once configured.
  const providers = useApi<ProvidersResponse>(providersUrl());
  const [section, setSection] = useState(currentSection);
  useEffect(() => {
    const update = () => setSection(currentSection());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const settingsItems = visibleSections((id) => !!providers.data?.providers.some((p) => p.id === id && p.configured));
  return (
    <aside className="side">
      <div className="brand">
        <Logo />
        TG Gateway
      </div>
      <nav className="nav" aria-label="Điều hướng">
        {(
          [
            ["/overview", "Tổng quan", "grid"],
            ["/requests", "Lịch sử", "clock"],
            ["/flow", "Sơ đồ", "route"],
            ["/settings", "Cài đặt", "gear"],
          ] as const
        ).map(([p, label, icon]) => (
          <a
            key={p}
            href={p}
            aria-current={path === p ? "page" : undefined}
            className={p === "/settings" && path === p ? "has-sub" : undefined}
            onClick={(e) => {
              if (!e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                go(p);
              }
            }}
          >
            <ActionIcon name={icon} size={18} />
            {label}
            {p === "/settings" && (
              <span className={"nav-caret" + (path === p ? " open" : "")} aria-hidden="true">
                <ActionIcon name="chevron-right" size={14} />
              </span>
            )}
          </a>
        ))}
        {path === "/settings" && (
          <div className="subnav" role="group" aria-label="Mục cài đặt">
            {settingsItems.map(([id, label, icon]) => (
              <a
                key={id}
                href={sectionPath(id)}
                aria-current={section === id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (section !== id) go(sectionPath(id));
                }}
              >
                {providerSections.includes(id) ? <Brand id={icon} size={16} /> : <ActionIcon name={icon as IconName} size={16} />}
                {label}
              </a>
            ))}
          </div>
        )}
      </nav>
      <div className="side-foot">
        {next && (
          <div className="update" role="status">
            <span title={buildDetail(next)}>Có bản mới {next.version !== BUILD.version ? buildLabel(next) : ""}</span>
            <button className="btn" onClick={() => location.reload()}>Tải lại</button>
          </div>
        )}
        <small className="build" title={buildDetail(BUILD)}>{buildLabel(BUILD)}</small>
        <Button loading={busy}
          className="btn full"
          onClick={() => {
            setBusy(true);
            void api("/api/session", { method: "DELETE" })
              .then(() => go("/login", { replace: true }))
              .catch((e) => setError(e.message)).finally(() => setBusy(false));
          }}
        >
          <ActionIcon name="logout" />
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
