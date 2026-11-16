import { digest, seal, unseal } from "./security.ts";
import { HttpError, type Env } from "./types.ts";
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
  fingerprint: string;
  credentials: Credentials;
}
export class KiroAuth {
  storage: DurableObjectStorage;
  env: Env;
  inflight?: Promise<Credentials>;
  cached?: Stored;
  constructor(storage: DurableObjectStorage, env: Env) {
    this.storage = storage;
    this.env = env;
  }
  async get(force = false): Promise<Credentials> {
    if (this.inflight) return this.inflight;
    this.inflight = this.load(force).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }
  private async load(force: boolean): Promise<Credentials> {
    if (!this.env.KIRO_CREDENTIALS || !this.env.VAULT_KEY)
      throw new HttpError(
        503,
        "credentials_missing",
        "Set KIRO_CREDENTIALS and VAULT_KEY in Cloudflare Secrets.",
      );
    const fingerprint = await digest(this.env.KIRO_CREDENTIALS);
    if (!this.cached) {
      const encrypted = await this.storage.get<string>("kiro-vault");
      if (encrypted) {
        try {
          this.cached = await unseal<Stored>(this.env.VAULT_KEY, encrypted);
        } catch {
          throw new HttpError(
            503,
            "vault_locked",
            "Cannot decrypt saved token. Restore VAULT_KEY or reset the token vault from Settings.",
          );
        }
      }
    }
    let credentials: Credentials;
    if (this.cached?.fingerprint === fingerprint)
      credentials = this.cached.credentials;
    else {
      let raw: unknown;
      try {
        raw = JSON.parse(this.env.KIRO_CREDENTIALS);
      } catch {
        throw new HttpError(
          503,
          "credentials_invalid",
          "KIRO_CREDENTIALS must be JSON.",
        );
      }
      if (
        !object(raw) ||
        typeof raw.refreshToken !== "string" ||
        !raw.refreshToken
      )
        throw new HttpError(
          503,
          "credentials_invalid",
          "Credentials require refreshToken.",
        );
      if (raw.clientIdHash && (!raw.clientId || !raw.clientSecret))
        throw new HttpError(
          503,
          "credentials_invalid",
          "Merge the SSO registration clientId/clientSecret into credentials first.",
        );
      if (Boolean(raw.clientId) !== Boolean(raw.clientSecret))
        throw new HttpError(
          503,
          "credentials_invalid",
          "SSO requires both clientId and clientSecret.",
        );
      credentials = raw as Credentials;
    }
    if (
      !force &&
      credentials.accessToken &&
      Date.parse(credentials.expiresAt ?? "") > Date.now() + 120_000
    ) {
      this.cached = { fingerprint, credentials };
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
        "User-Agent": "KiroIDE-0.7.45-tg-gateway",
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
    const stored = { fingerprint, credentials };
    // Persist rotated refresh tokens before using them. No plaintext credentials in SQL or logs.
    await this.storage.put(
      "kiro-vault",
      await seal(this.env.VAULT_KEY, stored),
    );
    this.cached = stored;
    return credentials;
  }
  async reset() {
    this.cached = undefined;
    await this.storage.delete("kiro-vault");
  }
}
