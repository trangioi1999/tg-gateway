import { useEffect, useRef, useState } from "react";
export function useDialogClose(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return { closing, close: () => {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(onClose, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160);
  } };
}
