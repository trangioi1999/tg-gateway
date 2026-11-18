import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
/**
 * Hover/focus tooltip rendered in <body>, so table cells with overflow:hidden do not clip
 * it. Placed under the trigger, kept inside the viewport.
 */
export default function Tip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 6 });
  };
  return (
    <span ref={ref} className={className} tabIndex={0} onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)}>
      {children}
      {at && createPortal(<div className="tip" role="tooltip" style={{ left: Math.max(8, at.x), top: at.y }}>{content}</div>, document.body)}
    </span>
  );
}
