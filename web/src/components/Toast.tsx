import { useEffect, useState } from "react";
import type { ToastMessage } from "../hooks/useToast";
export default function Toast({ message: notification }: { message: ToastMessage }) {
  const message = notification.text;
  const [visible, setVisible] = useState(message);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (message) { setVisible(message); setClosing(false); }
    else setClosing(true);
    const exit = setTimeout(() => { if (!message) setVisible(""); }, 160);
    const hide = setTimeout(() => setClosing(true), 3840);
    const remove = setTimeout(() => setVisible(""), 4000);
    return () => { clearTimeout(exit); clearTimeout(hide); clearTimeout(remove); };
  }, [message, notification.id]);
  return visible ? <p className={`keep toast${closing ? " toast-closing" : ""}`} role="status">{visible}</p> : null;
}
