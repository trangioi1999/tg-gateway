import { useDialogClose } from "../hooks/useDialogClose";
import Button from "./Button";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
export default function ConfirmClear({
  onClose,
  onCleared,
}: {
  onClose: () => void;
  onCleared: (deleted: number) => void;
}) {
  const { closing, close } = useDialogClose(onClose);
  const ref = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState("old"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog className={closing ? "dialog-closing" : ""}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="clear-title"
    >
      <div className="confirm">
        <h2 id="clear-title">Xóa log request?</h2>
        <p>
          Chỉ xóa chi tiết từng request. Số tổng theo ngày, tuần, tháng được giữ
          nguyên. Không thể hoàn tác.
        </p>
        <div className="opts">
          {[
            ["old", "Log cũ hơn 7 ngày"],
            ["all", "Toàn bộ log"],
          ].map(([v, label]) => (
            <label key={v}>
              <input
                type="radio"
                name="clear-scope"
                checked={scope === v}
                onChange={() => setScope(v)}
                disabled={busy}
              />
              {label}
            </label>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="acts">
          <Button className="btn" disabled={busy} onClick={close}>
            Hủy
          </Button>
          <Button
            className="btn danger-fill"
            loading={busy} disabled={closing}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await api<{ deleted: number }>(
                  "/api/requests" +
                    (scope === "old"
                      ? "?before=" + (Date.now() - 7 * 86400000)
                      : ""),
                  { method: "DELETE" },
                );
                onCleared(result.deleted);
                close();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Không thể xóa log.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {"Xóa log"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
