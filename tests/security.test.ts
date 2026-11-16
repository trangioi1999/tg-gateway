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
