import { inFlight } from "./inFlight";
import { go } from "../router";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  init?: RequestInit,
  responseType: "json" | "blob" = "json",
): Promise<T> {
  const release = inFlight.begin();
  try {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  if (response.ok && responseType === "blob")
    return (await response.blob()) as T;
  const data = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/session")
      go("/login", { replace: true });
    throw new ApiError(
      response.status,
      data?.error?.code ?? "request_failed",
      data?.error?.message ?? "Không thể tải dữ liệu.",
    );
  }
  return data as T;
  } finally { release(); }
}
