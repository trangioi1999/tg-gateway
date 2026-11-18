import { useSyncExternalStore } from "react";
export type Route = "/login" | "/overview" | "/requests" | "/flow" | "/settings";
export function go(path: string, { replace = false } = {}) {
  if (path === "/login" && location.pathname === "/login") return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};
export function useRoute() {
  const url = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
  );
  const path = url.split("?")[0] as Route;
  return {
    path: ["/login", "/overview", "/requests", "/flow", "/settings"].includes(path)
      ? path
      : ("/overview" as Route),
    go,
  };
}
