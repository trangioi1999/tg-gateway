import { useEffect, useState } from "react";
import { BUILD, type BuildInfo } from "../build";
/** The deployed build when it differs from the one this tab runs (checked every 5 min and on focus). */
export function useNewBuild(): BuildInfo | null {
  const [next, setNext] = useState<BuildInfo | null>(null);
  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const r = await fetch("/version.json", { cache: "no-store" });
        if (!r.ok) return;
        const deployed = (await r.json()) as BuildInfo;
        if (!stopped && deployed.builtAt !== BUILD.builtAt) setNext(deployed);
      } catch {}
    }
    void check();
    const timer = setInterval(check, 5 * 60_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return next;
}
