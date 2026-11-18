/** One line-icon set for the console: 24px grid, 1.5 stroke, colored by the surrounding text. */
export type IconName =
  | "wrap" | "copy" | "check" | "eye" | "eye-off"
  | "refresh" | "download" | "chevron-left" | "chevron-right" | "arrow-right"
  | "sliders" | "scissors" | "wallet" | "plug" | "database" | "split"
  | "stop" | "x" | "info" | "grid" | "clock" | "gear" | "route" | "logout";
export default function ActionIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "wrap" && <><path d="M3 6h18M3 12h14a3 3 0 0 1 0 6h-5M3 18h4" /><path d="m15 15-3 3 3 3" /></>}
      {name === "copy" && <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
      {name === "check" && <path d="m5 12 4 4L19 6" />}
      {name === "eye" && <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>}
      {name === "eye-off" && <><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 3.9M6.2 6.2A21 21 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>}
      {name === "refresh" && <><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4.5h-4.5" /></>}
      {name === "download" && <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>}
      {name === "chevron-left" && <path d="m15 6-6 6 6 6" />}
      {name === "chevron-right" && <path d="m9 6 6 6-6 6" />}
      {name === "arrow-right" && <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>}
      {name === "sliders" && <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>}
      {name === "scissors" && <><circle cx="6" cy="7" r="2.5" /><circle cx="6" cy="17" r="2.5" /><path d="M8 8.5 20 18M8 15.5 20 6" /></>}
      {name === "wallet" && <><path d="M4 7a2 2 0 0 1 2-2h11v4" /><rect x="4" y="9" width="16" height="10" rx="2" /><path d="M16 14h.01" /></>}
      {name === "plug" && <><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0Z" /><path d="M12 17v4" /></>}
      {name === "split" && <><path d="M3 12h7c3 0 4-6 8-6h3M10 12c3 0 4 6 8 6h3" /><path d="m18 3 3 3-3 3M18 15l3 3-3 3" /></>}
      {name === "stop" && <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />}
      {name === "x" && <path d="M6 6l12 12M18 6 6 18" />}
      {name === "info" && <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>}
      {name === "grid" && <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>}
      {name === "clock" && <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>}
      {name === "gear" && <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>}
      {name === "route" && <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></>}
      {name === "logout" && <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4M6 12h10" /></>}
      {name === "database" && <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>}
    </svg>
  );
}
