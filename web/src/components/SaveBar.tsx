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
  // The bar only appears when there is something to save; the toast floats on its own.
  return (
    <>
    <Toast message={message} />
    {(count > 0 || busy) && <div className="savebar section-enter">
      <div>
        <span>Có {count} thay đổi chưa lưu</span>
      </div>
      <Button
        className="btn primary"
        disabled={!count} loading={busy}
        onClick={onSave}
      >
        {"Lưu cài đặt"}
      </Button>
    </div>}
    </>
  );
}
