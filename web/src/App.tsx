import ProgressBar from "./components/ProgressBar";
import ThemeToggle from "./components/ThemeToggle";
import Skeleton from "./components/Skeleton";
import ErrorCard from "./components/ErrorCard";
import { useTheme } from "./theme";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import { useRoute } from "./router";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Requests from "./pages/Requests";
import Settings from "./pages/Settings";
import Flow from "./pages/Flow";
export default function App() {
  const [theme, setTheme] = useTheme();
  const { path, go } = useRoute();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [revision, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setError("");
    api("/api/session", { signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted && location.pathname === "/login")
          go("/overview", { replace: true });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401)
          go("/login", { replace: true });
        else setError(e instanceof Error ? e.message : "Không thể tải phiên đăng nhập.");
      })
      .finally(() => { if (!controller.signal.aborted) setReady(true); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    document.title = `${path === "/requests" ? "Lịch sử" : path === "/flow" ? "Sơ đồ" : path === "/settings" ? "Cài đặt" : path === "/login" ? "Đăng nhập" : "Tổng quan"} · TG Gateway`;
  }, [path]);
  const headerTools = <ThemeToggle theme={theme} setTheme={setTheme} />;
  return (
    <div className="stage">
      <ProgressBar />
      {!ready ? (
        <Skeleton className="loading" rows={5} />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => retry(n => n + 1)} />
      ) : path === "/login" ? (
        <>
          <div className="login-theme"><ThemeToggle theme={theme} setTheme={setTheme} /></div>
          <Login />
        </>
      ) : (
        <div className="frame">
          <Sidebar />
          <main className="main route-enter" key={path}>
            {path === "/overview" ? (
              <Overview headerTools={headerTools} />
            ) : path === "/requests" ? (
              <Requests headerTools={headerTools} />
            ) : path === "/flow" ? (
              <Flow headerTools={headerTools} />
            ) : (
              <Settings headerTools={headerTools} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
