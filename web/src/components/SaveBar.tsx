import type { ToastMessage } from "../hooks/useToast";
import Toast from "./Toast";
import Button from "./Button";
export default function SaveBar({
  count,
  busy,
  error,
  message,
  onSave,
}: {
  count: number;
  busy: boolean;
  error: string;
  message: ToastMessage;
  onSave: () => void;
}) {
  return (
    <div className="savebar">
      <div>
        <span>Có {count} thay đổi chưa lưu</span>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Toast message={message} />
      </div>
      <Button
        className="btn primary"
        disabled={!count} loading={busy}
        onClick={onSave}
      >
        {"Lưu cài đặt"}
      </Button>
    </div>
  );
}
