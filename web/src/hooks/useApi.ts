import { useEffect, useState } from "react";
import { api } from "../api/client";
export function useApi<T>(url: string, revision = 0) {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(url, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setData(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision, attempt]);
  return { data, error, loading, retry: () => setAttempt(n => n + 1) };
}
