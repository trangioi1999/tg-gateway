import { HttpError } from "./types.ts";
const encoder = new TextEncoder();
export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function equal(a: string, b: string): Promise<boolean> {
  const aa = await digest(a),
    bb = await digest(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++)
    diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}
async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
      ),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export async function makeSession(
  secret: string,
  password: string,
): Promise<string> {
  const payload = `${Date.now() + 8 * 3600_000}.${crypto.randomUUID()}`;
  return `${payload}.${await hmac(secret + (await digest(password)), payload)}`;
}
export async function validSession(
  token: string,
  secret: string,
  password: string,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;
  const expiry = Number(parts[0]);
  if (expiry < Date.now() || expiry > Date.now() + 8 * 3600_000) return false;
  return equal(
    parts[2],
    await hmac(secret + (await digest(password)), parts.slice(0, 2).join(".")),
  );
}
export function requireOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new HttpError(
      403,
      "origin_rejected",
      "Same-origin request required.",
    );
}
async function aesKey(secret: string): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/i.test(secret))
    throw new HttpError(
      503,
      "vault_unconfigured",
      "VAULT_KEY must be 64 hex characters.",
    );
  const bytes = Uint8Array.from(secret.match(/../g)!, (v) => parseInt(v, 16));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(secret: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey(secret),
      encoder.encode(JSON.stringify(value)),
    ),
  );
  return btoa(String.fromCharCode(...iv, ...encrypted));
}
export async function unseal<T>(secret: string, value: string): Promise<T> {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    await aesKey(secret),
    bytes.slice(12),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
export async function readJson(
  request: Request,
  limit = 1_048_576,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "invalid_content_type", "Use application/json.");
  if (!request.body)
    throw new HttpError(400, "invalid_json", "JSON body required.");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(
          413,
          "body_too_large",
          "Request body is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, "invalid_json", "Malformed JSON.");
  }
}
