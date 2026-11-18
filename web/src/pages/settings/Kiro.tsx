import ActionIcon from "../../components/ActionIcon";
import { useToast } from "../../hooks/useToast";
import Toast from "../../components/Toast";
import Skeleton from "../../components/Skeleton";
import ErrorCard from "../../components/ErrorCard";
import Button from "../../components/Button";
import { useRef, useState } from "react";
import type { KiroStatus } from "../../../../src/dashboard/contract";
import { api } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import ConfirmResetVault from "../../components/ConfirmResetVault";
import Row from "../../components/Row";
import { fmtCompact } from "../../lib/format";
import type { SectionProps } from "./types";
type Picked = {
  credentials?: Record<string, unknown>;
  registration?: Record<string, unknown>;
};
function classify(values: unknown[]): Picked {
  const picked: Picked = {};
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const data = value as Record<string, unknown>;
      if (typeof data.refreshToken === "string") picked.credentials = data;
      else if (data.clientId && data.clientSecret) picked.registration = data;
    }
  }
  return picked;
}
export default function Kiro({ draft, set, providers }: SectionProps) {
  const [revision, refresh] = useState(0),
    status = useApi<KiroStatus>("/api/kiro", revision),
    provider = providers.find((p) => p.id === "kiro");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]),
    [paste, setPaste] = useState(""),
    [message, setMessage] = useToast(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  function addFiles(chosen: File[]) {
    if (busy) return;
    setError("");
    setSelectedFiles(previous => [...previous, ...chosen.filter(file =>
      !previous.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)
    )]);
  }
  async function upload() {
    setError("");
    setMessage("");
    let next: Picked;
    try {
      next = classify(await Promise.all(selectedFiles.map(async file => JSON.parse(await file.text()) as unknown)));
    } catch {
      setError("Không thể đọc JSON. Kiểm tra lại file đã chọn.");
      return;
    }
    try {
      if (paste.trim()) {
        const data: unknown = JSON.parse(paste);
        next = { ...next, ...classify(Array.isArray(data) ? data : [data]) };
      }
    } catch {
      setError("Nội dung dán không phải JSON hợp lệ.");
      return;
    }
    if (!next.credentials) {
      setError("Chưa thấy file có refreshToken (kiro-auth-token.json).");
      return;
    }
    if (
      next.credentials.clientIdHash &&
      !next.credentials.clientId &&
      !next.registration
    ) {
      setError(
        "Đăng nhập Builder ID/SSO: chọn thêm file " +
          String(next.credentials.clientIdHash) +
          ".json cùng thư mục.",
      );
      return;
    }
    setBusy(true);
    try {
      await api("/api/kiro", {
        method: "PUT",
        body: JSON.stringify({
          credentials: next.credentials,
          registration: next.registration,
        }),
      });
      setSelectedFiles([]);
      setPaste("");
      if (files.current) files.current.value = "";
      setMessage("Đã lưu. Gateway dùng token này cho request tiếp theo.");
      refresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể lưu token.");
    } finally {
      setBusy(false);
    }
  }
  const source = status.data
    ? {
        dashboard: "Đã lưu từ trang này",
        secret: "Từ Cloudflare Secret KIRO_CREDENTIALS",
        none: "Chưa có token Kiro",
      }[status.data.source]
    : status.loading
      ? ""
      : "Không lấy được trạng thái";
  return (
    <>
      {confirmReset && <ConfirmResetVault onClose={() => setConfirmReset(false)} onReset={() => {
        setError("");
        setMessage("Đã reset token vault.");
        refresh((n) => n + 1);
      }} />}
      <div className="group">
        <h3>Tài khoản</h3>
        <div className={status.loading && status.data ? "rows refetching" : "rows"}>
          <Row
            label="Trạng thái"
            note={
              status.data?.expiresAt
                ? `Token hết hạn ${new Date(status.data.expiresAt).toLocaleString("vi-VN")}`
                : undefined
            }
          >
            <span className="val">
              {status.loading && !status.data ? <Skeleton /> : source}
              {status.data?.type
                ? ` · ${status.data.type === "sso" ? "Builder ID/SSO" : "Google/GitHub"}`
                : ""}
            </span>
          </Row>
          <Row label="Gói">
            <span className="val">{provider?.plan ?? "—"}</span>
          </Row>
          <Row
            label="Credit tháng này"
            note={
              provider?.resetAt
                ? "Đặt lại " +
                  new Date(provider.resetAt).toLocaleDateString("vi-VN")
                : undefined
            }
          >
            <span className="val num">
              {provider?.ok
                ? `${fmtCompact(provider.used ?? 0)} / ${fmtCompact(provider.limit ?? 0)}`
                : provider?.error === "not_configured" ? "Chưa kết nối" : "Không lấy được số liệu"}
            </span>
          </Row>
          <Row label="Tải token Kiro" stack>
            <div
              className={dragging ? "drop dragging" : "drop"}
              onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
              onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}
            >
              <span>Kéo thả file kiro-auth-token.json và file đăng ký SSO vào đây</span>
              <input
                ref={files}
                hidden
                aria-label="File token Kiro"
                type="file"
                accept=".json,application/json"
                multiple
                disabled={busy}
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <Button className="btn" type="button" disabled={busy} onClick={() => files.current?.click()}>Chọn file</Button>
              {selectedFiles.length > 0 && <ul className="picked-files">
                {selectedFiles.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}>
                  <span>{file.name}</span>
                  <Button type="button" disabled={busy} aria-label={`Bỏ file ${file.name}`} onClick={() => setSelectedFiles(previous => previous.filter((_, i) => i !== index))}><ActionIcon name="x" size={14} /></Button>
                </li>)}
              </ul>}
            </div>
            <textarea
              aria-label="Dán JSON token Kiro"
              placeholder="Dán JSON"
              rows={4}
              value={paste}
              disabled={busy}
              onChange={(e) => setPaste(e.target.value)}
            />
            <small className="hint">
              macOS: ~/.aws/sso/cache/ · Builder ID/SSO cần thêm file
              &lt;clientIdHash&gt;.json
            </small>
            <Button className="btn primary" loading={busy} onClick={upload}>
              {"Lưu token"}
            </Button>
          </Row>
        </div>
        {status.error && <ErrorCard message={status.error} onRetry={status.retry} />}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Toast message={message} />
      </div>
      <div className="group">
        <h3>Kết nối</h3>
        <div className="rows">
          <Row label="API region" note="Kiro chỉ có us-east-1 và eu-central-1">
            <input
              aria-label="API region"
              type="text"
              value={draft.apiRegion}
              onChange={(e) => set("apiRegion", e.target.value)}
            />
          </Row>
          <Row label="Phiên bản Kiro" note="Kiro IDE → Help → About">
            <input
              aria-label="Phiên bản Kiro"
              type="text"
              value={draft.kiroVersion}
              onChange={(e) => set("kiroVersion", e.target.value)}
            />
          </Row>
        </div>
      </div>
      <div className="group">
        <h3>Token vault</h3>
        <div className="rows">
          <Row
            label="Reset token vault"
            note="Xóa token refresh đang lưu. Gateway dùng lại KIRO_CREDENTIALS nếu có."
          >
            <Button className="btn danger" disabled={busy} onClick={() => setConfirmReset(true)}>
              Reset
            </Button>
          </Row>
        </div>
      </div>
    </>
  );
}
