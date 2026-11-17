import { useState, useEffect } from "react";
export type Theme = "light" | "dark" | "auto";
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const v = localStorage.getItem("tg-theme");
      return v === "light" || v === "dark" ? v : "auto";
    } catch {
      return "auto";
    }
  });
  useEffect(() => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("tg-theme", theme);
    } catch {}
  }, [theme]);
  return [theme, setTheme];
}
