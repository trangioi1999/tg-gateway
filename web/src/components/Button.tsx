import type { ButtonHTMLAttributes } from "react";
import Spinner from "./Spinner";
export default function Button({ loading = false, rotate = false, children, className = "", disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; rotate?: boolean }) {
  return <button {...props} className={`${className} async-button`} disabled={disabled || loading} aria-busy={loading}>
    <span className={loading ? (rotate ? "button-label spinner" : "button-label pending") : "button-label"}>{children}</span>
    {loading && !rotate && <span className="button-spinner"><Spinner /></span>}
  </button>;
}
