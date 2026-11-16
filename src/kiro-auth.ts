import { digest, seal, unseal } from "./security.ts";
import { HttpError, defaults, type Env } from "./types.ts";
import { object } from "./protocol.ts";
interface Credentials {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: string;
  profileArn?: string;
  region?: string;
  clientId?: string;
  clientSecret?: string;
}
interface Stored {
  /** Digest of KIRO_CREDENTIALS (or "") when this entry was written; a changed secret wins. */
  fingerprint: string;
  credentials: Credentials;
  /** "dashboard" when uploaded from Settings; absent when derived from the secret. */
  source?: "dashboard";
}
export interface KiroStatus {
  source: "dashboard" | "secret" | "none";
  type?: "social" | "sso";
  region?: string;
  expiresAt?: string;
}
const FIELDS = ["refreshToken", "accessToken", "expiresAt", "profileArn", "region", "clientId", "clientSecret"] as const;
const invalid = (message: string) => new HttpError(503, "credentials_invalid", message);
/**
 * Validate a Kiro token file (kiro-auth-token.json). For Builder ID / IAM Identity Center
 * logins the file only carries clientIdHash; pass the matching registration file
 * (<clientIdHash>.json) to supply clientId/clientSecret. Only auth fields are kept.
 */
export function parseCredentials(raw: unknown, registration?: unknown): Credentials {
  if (!object(raw) || typeof raw.refreshToken !== "string" || !raw.refreshToken)
    throw invalid("Credentials require refreshToken.");
  const data: Record<string, unknown> = { ...raw };
  if (object(registration) && !data.clientId) {
    data.clientId = registration.clientId;
    data.clientSecret = registration.clientSecret;
  }
  if (data.clientIdHash && (!data.clientId || !data.clientSecret))
    throw invalid("Merge the SSO registration clientId/clientSecret into credentials first.");
  if (Boolean(data.clientId) !== Boolean(data.clientSecret))
    throw invalid("SSO requires both clientId and clientSecret.");
  return Object.fromEntries(
    FIELDS.filter((k) => typeof data[k] === "string" && data[k]).map((k) => [k, data[k]]),
  ) as unknown as Credentials;
}
export class KiroAuth {
  storage: DurableObjectStorage;
  env: Env;
  inflight?: Promise<Credentials>;
  cached?: Stored;
  /** Access token upstream rejected; any load that would return it refreshes instead. */
  rejected?: string;
  constructor(storage: DurableObjectStorage, env: Env) {
    this.storage = storage;
    this.env = env;
  }
  /**
   * Single-flight credential load. Pass `rejected` (the token upstream refused) to force a
   * refresh. Concurrent callers that saw the same rejection share one refresh, and a caller
   * whose token was already replaced by another refresh reuses the new token.
   */
  async get(rejected?: string): Promise<Credentials> {
    if (rejected) this.rejected = rejected;
    for (;;) {
      if (!this.inflight) {
        this.inflight = this.load().finally(() => {
          this.inflight = undefined;
        });
        return this.inflight;
      }
      const current = await this.inflight;
      if (!this.rejected || current.accessToken !== this.rejected)
        return current;
    }
  }
  private async restore(): Promise<Stored | undefined> {
    if (this.cached) return this.cached;
    const encrypted = await this.storage.get<string>("kiro-vault");
    if (!encrypted) return undefined;
    try {
      return (this.cached = await unseal<Stored>(this.env.VAULT_KEY!, encrypted));
    } catch {
      throw new HttpError(
        503,
        "vault_locked",
        "Cannot decrypt saved token. Restore VAULT_KEY or reset the token vault from Settings.",
      );
    }
  }
  /** Saved entry still in force: same secret as when written, or a dashboard upload with no secret. */
  private usable(stored: Stored | undefined, fingerprint: string): stored is Stored {
    return Boolean(
      stored && (stored.fingerprint === fingerprint || (stored.source === "dashboard" && !this.env.KIRO_CREDENTIALS)),
    );
  }
  private async load(): Promise<Credentials> {
    if (!this.env.VAULT_KEY)
      throw new HttpError(503, "credentials_missing", "Set VAULT_KEY in Cloudflare Secrets.");
    const fingerprint = await digest(this.env.KIRO_CREDENTIALS ?? "");
    const saved = await this.restore();
    let credentials: Credentials;
    let source: Stored["source"];
    if (this.usable(saved, fingerprint)) {
      credentials = saved.credentials;
      source = saved.source;
    } else if (!this.env.KIRO_CREDENTIALS)
      throw new HttpError(
        503,
        "credentials_missing",
        "Add Kiro credentials in dashboard Settings (Kiro login) or set KIRO_CREDENTIALS.",
      );
    else {
      let raw: unknown;
      try {
        raw = JSON.parse(this.env.KIRO_CREDENTIALS);
      } catch {
        throw invalid("KIRO_CREDENTIALS must be JSON.");
      }
      credentials = parseCredentials(raw);
    }
    if (
      credentials.accessToken &&
      credentials.accessToken !== this.rejected &&
      Date.parse(credentials.expiresAt ?? "") > Date.now() + 120_000
    ) {
      this.cached = { fingerprint, credentials, source };
      return credentials;
    }
    const region = credentials.region ?? "us-east-1";
    if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region))
      throw new HttpError(503, "credentials_invalid", "Invalid auth region.");
    const sso = Boolean(credentials.clientId && credentials.clientSecret);
    const url = sso
      ? `https://oidc.${region}.amazonaws.com/token`
      : `https://prod.${region}.auth.desktop.kiro.dev/refreshToken`;
    const payload = sso
      ? {
          grantType: "refresh_token",
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
        }
      : { refreshToken: credentials.refreshToken };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `KiroIDE-${defaults.kiroVersion}-tg-gateway`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(
        502,
        "kiro_auth_failed",
        `Kiro token refresh failed (HTTP ${response.status}). Re-login and upload fresh credentials.`,
      );
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.accessToken !== "string")
      throw new HttpError(
        502,
        "kiro_auth_failed",
        "Kiro returned no access token.",
      );
    const seconds =
      typeof data.expiresIn === "number" &&
      Number.isFinite(data.expiresIn) &&
      data.expiresIn > 0
        ? data.expiresIn
        : 3600;
    credentials = {
      ...credentials,
      accessToken: data.accessToken,
      refreshToken:
        typeof data.refreshToken === "string"
          ? data.refreshToken
          : credentials.refreshToken,
      profileArn:
        typeof data.profileArn === "string"
          ? data.profileArn
          : credentials.profileArn,
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    };
    const stored: Stored = { fingerprint, credentials, source };
    // Persist rotated refresh tokens before using them. No plaintext credentials in SQL or logs.
    await this.storage.put(
      "kiro-vault",
      await seal(this.env.VAULT_KEY, stored),
    );
    this.cached = stored;
    return credentials;
  }
  /** Save credentials uploaded from Settings, verify them, and roll back if they don't work. */
  async save(credentials: Credentials): Promise<KiroStatus> {
    if (!this.env.VAULT_KEY)
      throw new HttpError(503, "credentials_missing", "Set VAULT_KEY in Cloudflare Secrets.");
    const previous = await this.storage.get<string>("kiro-vault");
    const stored: Stored = {
      fingerprint: await digest(this.env.KIRO_CREDENTIALS ?? ""),
      credentials,
      source: "dashboard",
    };
    await this.storage.put("kiro-vault", await seal(this.env.VAULT_KEY, stored));
    this.cached = stored;
    this.rejected = undefined;
    try {
      await this.get();
    } catch (error) {
      this.cached = undefined;
      if (previous) await this.storage.put("kiro-vault", previous);
      else await this.storage.delete("kiro-vault");
      throw error;
    }
    return this.status();
  }
  /** Where credentials come from, without contacting Kiro or exposing token values. */
  async status(): Promise<KiroStatus> {
    if (!this.env.VAULT_KEY) return { source: "none" };
    let saved: Stored | undefined;
    try {
      saved = await this.restore();
    } catch {
      saved = undefined;
    }
    const fingerprint = await digest(this.env.KIRO_CREDENTIALS ?? "");
    if (this.usable(saved, fingerprint)) {
      const c = saved.credentials;
      return {
        source: saved.source ?? "secret",
        type: c.clientId ? "sso" : "social",
        region: c.region ?? "us-east-1",
        expiresAt: c.expiresAt,
      };
    }
    return { source: this.env.KIRO_CREDENTIALS ? "secret" : "none" };
  }
  async reset() {
    this.cached = undefined;
    await this.storage.delete("kiro-vault");
  }
}
