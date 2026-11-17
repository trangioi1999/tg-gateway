import { useDialogClose } from "../hooks/useDialogClose";
import Button from "./Button";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
export default function ConfirmResetVault({ onClose, onReset }: {
  onClose: () => void;
  onReset: () => void;
}) {
  const { closing, close } = useDialogClose(onClose);
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog className={closing ? "dialog-closing" : ""} ref={ref} aria-labelledby="reset-vault-title" onCancel={(e) => {
      e.preventDefault();
      if (!busy) close();
    }}>
      <div className="confirm">
        <h2 id="reset-vault-title">Xóa token Kiro đang lưu?</h2>
        <p>Xóa cả token đã nhập ở trang này. Gateway sẽ dùng lại KIRO_CREDENTIALS nếu có. Không thể hoàn tác.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="acts">
          <Button className="btn" disabled={busy} onClick={close} autoFocus>Hủy</Button>
          <Button className="btn danger-fill" loading={busy} disabled={closing} onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/api/vault/reset", { method: "POST" });
              onReset();
              close();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Không thể reset token vault.");
            } finally {
              setBusy(false);
            }
          }}>{"Xóa token"}</Button>
        </div>
      </div>
    </dialog>
  );
}
