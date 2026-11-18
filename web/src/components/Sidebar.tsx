import ActionIcon from "./ActionIcon";
import Logo from "./Logo";
import Button from "./Button";
import { useRoute } from "../router";
import { api } from "../api/client";
import { useState } from "react";
import { BUILD, buildDetail, buildLabel } from "../build";
import { useNewBuild } from "../hooks/useNewBuild";
export default function Sidebar() {
  const { path, go } = useRoute();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = useNewBuild();
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
            onClick={(e) => {
              if (!e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                go(p);
              }
            }}
          >
            <ActionIcon name={icon} size={18} />
            {label}
          </a>
        ))}
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
