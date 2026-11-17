import type { ReactNode } from "react";
import { useToast } from "../hooks/useToast";
import Skeleton from "../components/Skeleton";
import ErrorCard from "../components/ErrorCard";
import { useEffect, useState } from "react";
import type { ProvidersResponse } from "../../../src/dashboard/contract";
import { api, ApiError } from "../api/client";
import { useApi } from "../hooks/useApi";
import { providersUrl } from "../lib/period";
import SaveBar from "../components/SaveBar";
import Brand from "../components/Brand";
import General from "./settings/General";
import Kiro from "./settings/Kiro";
import ClaudeApi from "./settings/ClaudeApi";
import OpenRouter from "./settings/OpenRouter";
import Saving from "./settings/Saving";
import Budget from "./settings/Budget";
import Connect from "./settings/Connect";
import Data from "./settings/Data";
import type {
  Settings as SettingsType,
  SettingsResponse,
  SettingsDraft,
} from "./settings/types";
const sections = [
  ["general", "Chung", "⚙"],
  ["kiro", "Kiro", "kiro"],
  ["anthropic", "Claude API", "anthropic"],
  ["openrouter", "OpenRouter", "openrouter"],
  ["saving", "Tiết kiệm credit", "✂"],
  ["budget", "Ngân sách", "◇"],
  ["connect", "Kết nối & bảo mật", "⇄"],
  ["data", "Dữ liệu & log", "▤"],
] as const;
const panels = {
  general: General,
  kiro: Kiro,
  anthropic: ClaudeApi,
  openrouter: OpenRouter,
  saving: Saving,
  budget: Budget,
  connect: Connect,
  data: Data,
};
function currentSection() {
  const hash = location.hash.slice(1);
  return sections.some(([id]) => id === hash) ? hash : "general";
}
export default function Settings({ headerTools }: { headerTools: ReactNode }) {
  const [revision, retry] = useState(0),
    result = useApi<SettingsResponse>("/api/settings", revision),
    providers = useApi<ProvidersResponse>(providersUrl(), revision);
  const [draft, setDraft] = useState<SettingsDraft>(),
    [saved, setSaved] = useState<SettingsType>(),
    [section, setSection] = useState(currentSection),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useToast();
  useEffect(() => {
    if (result.data) {
      setDraft(result.data.settings);
      setSaved(result.data.settings);
    }
  }, [result.data]);
  useEffect(() => {
    const update = () => setSection(currentSection());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const visibleSections = sections.filter(([id]) => !["kiro", "anthropic", "openrouter"].includes(id) || providers.data?.providers.some(p => p.id === id && p.configured));
  const activeSection = visibleSections.some(([id]) => id === section) ? section : "general";
  useEffect(() => {
    if (!providers.loading && section !== activeSection) {
      setSection("general");
      history.replaceState(null, "", location.pathname + location.search + "#general");
    }
  }, [providers.loading, section, activeSection]);
  const count =
    draft && saved
      ? (Object.keys(draft) as (keyof SettingsType)[]).filter(
          (k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]),
        ).length
      : 0;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (count) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);
  function set<K extends keyof SettingsType>(key: K, value: SettingsDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setMessage("");
    setError("");
  }
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      for (const key of Object.keys(draft) as (keyof SettingsType)[]) {
        if (typeof saved?.[key] === "number" && (draft[key] === "" || !Number.isFinite(draft[key])))
          throw new Error("Cài đặt không hợp lệ: các trường số không được để trống và phải là số hợp lệ.");
      }
      const next = {
        ...draft,
        models: draft.models.map((m) => m.trim()).filter(Boolean),
      };
      const response = await api<{ settings: SettingsType }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setDraft(response.settings);
      setSaved(response.settings);
      setMessage("Đã lưu cài đặt.");
    } catch (e) {
      const labels: Record<string, string> = {
        invalid_settings: "Cài đặt không hợp lệ",
        invalid_request: "Yêu cầu không hợp lệ",
        unauthorized: "Phiên đăng nhập đã hết hạn",
        forbidden: "Không có quyền lưu cài đặt",
        internal_error: "Lỗi máy chủ",
      };
      setError(e instanceof ApiError && labels[e.code]
        ? `${labels[e.code]}: ${e.message}`
        : e instanceof Error ? e.message : "Không thể lưu cài đặt.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page">
      <div className="top settings-header">
        <div>
          <div className="crumb">Workspace</div>
          <h1>Cài đặt</h1>
          <p className="lead">Thay đổi áp dụng cho request mới.</p>
        </div>
        <div className="tools">
          <SaveBar
              count={count}
              busy={busy}
              message={message}
              onSave={save}
          />
          {headerTools}
        </div>
        {error && <p className="header-error error" role="alert">{error}</p>}
      </div>
      {result.loading && !draft && <div className="set-wrap" aria-busy="true"><nav className="snav" aria-label="Mục cài đặt">{visibleSections.map(([id, label]) => <button disabled key={id}><span className="si"><Skeleton /></span>{label}</button>)}</nav><div className="spanel"><Skeleton className="rows skeleton-settings" rows={6} /></div></div>}
      {result.error && <ErrorCard message={result.error} onRetry={result.retry} />}
      {providers.error && <ErrorCard message={providers.error} onRetry={providers.retry} />}
      {draft && result.data && (
        <div className={result.loading || providers.loading ? "set-wrap refetching" : "set-wrap"}>
          <nav className="snav" aria-label="Mục cài đặt">
            {visibleSections.map(([id, label, icon]) => (
              <button
                key={id}
                aria-pressed={activeSection === id}
                onClick={() => {
                  location.hash = id;
                  setSection(id);
                }}
              >
                <span
                  className="si"
                  style={{
                    background: [
                      "var(--icon-neutral)",
                      "var(--fill)",
                      "var(--fill)",
                      "var(--fill)",
                      "var(--icon-saving)",
                      "var(--icon-budget)",
                      "var(--icon-connect)",
                      "var(--icon-data)",
                    ][sections.findIndex(([key]) => key === id)],
                  }}
                >
                  {["kiro", "anthropic", "openrouter"].includes(icon) ? (
                    <Brand id={icon} size={18} />
                  ) : (
                    icon
                  )}
                </span>
                {label}
              </button>
            ))}
          </nav>
          <div>
            {visibleSections.map(([id]) => {
              const Panel = panels[id];
              return (
                <div className="spanel" key={id} hidden={activeSection !== id}>
                  <fieldset disabled={busy}>
                    <Panel
                      draft={draft}
                      saved={saved}
                      set={set}
                      secrets={result.data?.secrets ?? {}}
                      providers={providers.data?.providers ?? []}
                    />
                  </fieldset>
                </div>
              );
            })}

          </div>
        </div>
      )}
    </section>
  );
}
