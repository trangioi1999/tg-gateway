import type { ToastMessage } from "../hooks/useToast";
import Toast from "./Toast";
import Button from "./Button";
export default function SaveBar({
  count,
  busy,
  message,
  onSave,
}: {
  count: number;
  busy: boolean;
  message: ToastMessage;
  onSave: () => void;
}) {
  return (
    <div className="savebar">
      <div>
        {count > 0 && <span>Có {count} thay đổi chưa lưu</span>}
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
