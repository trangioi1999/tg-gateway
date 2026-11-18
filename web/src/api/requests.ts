import { api } from "./client";
/** Stops an in-flight request (the client receives a `cancelled` error). */
export const stopRequest = (id: string) =>
  api<{ ok: true }>("/api/requests/" + encodeURIComponent(id) + "/cancel", { method: "POST" });
