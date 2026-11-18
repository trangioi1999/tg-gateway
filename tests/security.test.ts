import { test } from "node:test";
import assert from "node:assert/strict";
import {
  equal,
  makeSession,
  validSession,
  seal,
  unseal,
  requireOrigin,
  readJson,
  readText,
} from "../src/security.ts";
test("sessions reject tampering and password/key rotation", async () => {
  const token = await makeSession("secret", "password");
  assert.ok(await validSession(token, "secret", "password"));
  assert.equal(await validSession(token + "x", "secret", "password"), false);
  assert.equal(await validSession(token, "secret", "new-password"), false);
  assert.equal(await validSession(token, "new-secret", "password"), false);
  assert.equal(await validSession("0.id.sig", "secret", "password"), false);
  assert.equal(await equal("a", "b"), false);
});
test("sign-out generation revokes sessions issued before it", async () => {
  const old = await makeSession("secret", "password", 0);
  assert.ok(await validSession(old, "secret", "password", 0));
  assert.equal(await validSession(old, "secret", "password", 1), false);
  const fresh = await makeSession("secret", "password", 1);
  assert.ok(await validSession(fresh, "secret", "password", 1));
});
test("readText stops a slow body when the signal aborts", async () => {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("{")); } });
  const request = new Request("https://x.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    // @ts-ignore Node needs duplex for a stream body.
    duplex: "half",
  });
  const abort = new AbortController();
  setTimeout(() => abort.abort(new Error("timeout")), 20);
  await assert.rejects(readText(request, 1000, abort.signal), /timeout/);
});
test("vault encryption is randomized, authenticated, and rejects wrong keys", async () => {
  const key = "a".repeat(64),
    payload = { refreshToken: "sensitive" };
  const a = await seal(key, payload),
    b = await seal(key, payload);
  assert.notEqual(a, b);
  assert.ok(!a.includes("sensitive"));
  assert.deepEqual(await unseal(key, a), payload);
  await assert.rejects(unseal("b".repeat(64), a));
  await assert.rejects(seal("short", payload));
});
test("CSRF origin gate and bounded JSON parsing", async () => {
  assert.throws(() =>
    requireOrigin(
      new Request("https://gateway.test/api/settings", {
        method: "PUT",
        headers: { Origin: "https://evil.test" },
      }),
    ),
  );
  requireOrigin(
    new Request("https://gateway.test/api/settings", {
      method: "PUT",
      headers: { Origin: "https://gateway.test" },
    }),
  );
  await assert.rejects(
    readJson(
      new Request("https://x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"x":"1234567890"}',
      }),
      5,
    ),
  );
  await assert.rejects(
    readJson(
      new Request("https://x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    ),
  );
});
