import { test } from "node:test";
import assert from "node:assert/strict";
import { KiroAuth } from "../src/kiro-auth.ts";
import { unseal } from "../src/security.ts";
import type { Env } from "../src/types.ts";
test("single-flight refresh persists encrypted rotated credentials across instances", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  const map = new Map();
  const storage = {
    get: async (key: string) => map.get(key),
    put: async (key: string, value: unknown) => map.set(key, value),
    delete: async (key: string) => map.delete(key),
  } as unknown as DurableObjectStorage;
  const env = {
    KIRO_CREDENTIALS: JSON.stringify({
      refreshToken: "original",
      region: "us-east-1",
    }),
    VAULT_KEY: "a".repeat(64),
  } as Env;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).refreshToken, "original");
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresIn: 3600,
    });
  };
  try {
    const auth = new KiroAuth(storage, env);
    const results = await Promise.all([auth.get(), auth.get(), auth.get()]);
    assert.equal(calls, 1);
    assert.ok(results.every((r) => r.accessToken === "access-new"));
    assert.ok(!map.get("kiro-vault").includes("refresh-new"));
    const saved = await unseal<{ credentials: { refreshToken: string } }>(
      env.VAULT_KEY!,
      map.get("kiro-vault"),
    );
    assert.equal(saved.credentials.refreshToken, "refresh-new");
    assert.equal(
      (await new KiroAuth(storage, env).get()).accessToken,
      "access-new",
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("SSO refresh sends OIDC client credentials to the auth region", async () => {
  const original = globalThis.fetch;
  const env = {
    KIRO_CREDENTIALS: JSON.stringify({
      refreshToken: "r",
      region: "eu-west-1",
      clientId: "id",
      clientSecret: "secret",
    }),
    VAULT_KEY: "b".repeat(64),
  } as Env;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://oidc.eu-west-1.amazonaws.com/token");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      grantType: "refresh_token",
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "r",
    });
    return Response.json({ accessToken: "access", expiresIn: 60 });
  };
  try {
    await new KiroAuth(
      {
        get: async () => undefined,
        put: async () => {},
      } as unknown as DurableObjectStorage,
      env,
    ).get();
  } finally {
    globalThis.fetch = original;
  }
});
