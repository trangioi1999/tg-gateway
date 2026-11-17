import type { Theme } from "../theme";
export default function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  return <div className="seg theme-toggle" role="group" aria-label="Giao diện">
    {([["light", "Sáng"], ["dark", "Tối"], ["auto", "Tự động"]] as const).map(([value, label]) =>
      <button key={value} type="button" aria-label={label} title={label} aria-pressed={theme === value} onClick={() => setTheme(value)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          {value === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : value === "dark" ? <path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z" /> : <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" /></>}
        </svg>
      </button>)}
  </div>;
}
