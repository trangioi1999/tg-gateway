import ActionIcon from "../components/ActionIcon";
import Button from "../components/Button";
import { useEffect, useState } from "react";
import Logo from "../components/Logo";
import { api, ApiError } from "../api/client";
import { go } from "../router";
export default function Login() {
  const [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [up, setUp] = useState<boolean | null>(null);
  // Public health check: tells whether the gateway itself is reachable before signing in.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/health", { signal: controller.signal })
      .then((r) => setUp(r.ok))
      .catch(() => { if (!controller.signal.aborted) setUp(false); });
    return () => controller.abort();
  }, []);
  return (
    <section className="signin">
      <div className="signin-card">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/api/session", {
                method: "POST",
                body: JSON.stringify({ password }),
              });
              go("/overview", { replace: true });
            } catch (e) {
              setError(
                e instanceof ApiError && e.status === 401
                  ? "Mật khẩu chưa đúng."
                  : e instanceof ApiError && e.status === 429
                    ? "Quá nhiều lần thử. Thử lại sau 1 phút."
                    : e instanceof Error
                      ? e.message
                      : "Không thể đăng nhập.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <Logo className="logo" />
          <div className="t">
            <h1>TG Gateway</h1>
            <p>Console quản trị</p>
          </div>
          <div className="field">
            <label htmlFor="password">Mật khẩu</label>
            <div className={"inp" + (error ? " err" : "")}>
              <input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
              />
              <Button
                className="password-toggle"
                type="button"
                aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                onClick={() => setShow(!show)}
              >
                <ActionIcon name={show ? "eye-off" : "eye"} size={18} />
              </Button>
            </div>
            {error && (
              <div role="alert" className="ferr">
                <i aria-hidden="true">!</i>
                {error}
              </div>
            )}
          </div>
          <Button className="go" loading={busy}>
            {"Tiếp tục"}
          </Button>
        </form>
      </div>
      <p className="signin-status" role="status">
        <i className={up === null ? "dot wait" : up ? "dot" : "dot off"} aria-hidden="true" />
        {up === null ? "Đang kiểm tra gateway" : up ? "Gateway đang hoạt động" : "Không kết nối được gateway"}
      </p>
      <div className="fine">
        © {new Date().getFullYear()} TG Gateway · By Trần Giỏi
      </div>
    </section>
  );
}
