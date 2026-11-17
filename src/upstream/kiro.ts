import { HttpError, type Settings } from "../types.ts";

// runtime.<region>.kiro.dev answers Workers with Cloudflare error 1016 (530); use the AWS host.
export const kiroHost = (s: Settings) => `q.${s.apiRegion}.amazonaws.com`;

/** POST a payload to Kiro with the given access token. Does not retry or check the status. */
export function kiroFetch(
  payload: object,
  s: Settings,
  token: string,
  instance: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(
    `https://${kiroHost(s)}/generateAssistantResponse`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target":
          "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
        Accept: "application/vnd.amazon.eventstream",
        "User-Agent": `aws-sdk-js/1.0.27 ua/2.1 os/win32#10.0.26100 lang/js md/nodejs#22.21.1 api/codewhispererstreaming#1.0.27 m/E KiroIDE-${s.kiroVersion}-${instance}`,
        "x-amz-user-agent": `aws-sdk-js/1.0.27 KiroIDE-${s.kiroVersion}-${instance}`,
        "x-amzn-codewhisperer-optout": "true",
        "x-amzn-kiro-agent-mode": "vibe",
        "amz-sdk-invocation-id": crypto.randomUUID(),
        "amz-sdk-request": "attempt=1; max=1",
      },
      body: JSON.stringify(payload),
      signal,
    },
  );
}

/** Structured AWS error (`__type`/`message`) from an upstream body, plus a raw excerpt for logs. */
export async function kiroError(response: Response, region: string): Promise<HttpError> {
  const status = response.status;
  const { reason, raw } = await upstreamReason(response);
  // Only visible to the account owner in `wrangler tail`.
  console.warn(`kiro_http_${status}: ${reason || raw}`);
  return new HttpError(
    [400, 402, 429].includes(status) ? status : 502,
    "kiro_http_" + status,
    // Clients get only the structured AWS error type/message, never the raw body.
    status === 530
      ? `No Kiro API endpoint in region "${region}". Set API region to us-east-1 (or eu-central-1) in Settings.`
      : `Kiro returned HTTP ${status}${reason ? ": " + reason : "."}`,
  );
}
async function upstreamReason(response: Response): Promise<{ reason: string; raw: string }> {
  let text = "";
  try {
    text = (await response.text()).slice(0, 2000);
  } catch {}
  const clean = (v: string) => v.replace(/\s+/g, " ").trim().slice(0, 300);
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const type = typeof data.__type === "string" ? data.__type.split("#").pop() : "";
    const message = [data.message, data.Message, data.reason].find((v) => typeof v === "string") as string | undefined;
    return { reason: clean([type, message].filter(Boolean).join(" – ")), raw: clean(text) };
  } catch {
    return { reason: "", raw: clean(text) };
  }
}
