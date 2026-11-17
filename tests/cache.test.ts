import { test } from "node:test";
import assert from "node:assert/strict";
import { ResponseCache, responseKey, snapshot, restore } from "../src/cache.ts";
import { Completion } from "../src/protocol.ts";

const answer = (text = "hi") => {
  const c = new Completion(10);
  c.text = text;
  c.tools = [{ id: "t", name: "Bash", arguments: "{}" }];
  c.outputTokens = 3;
  c.outputSource = "reported";
  return snapshot(c);
};

test("key ignores conversationId and profileArn, nothing else", async () => {
  const base = { conversationState: { conversationId: "a", currentMessage: { userInputMessage: { content: "x" } } } };
  const k = await responseKey(base);
  assert.equal(k, await responseKey({ ...base, profileArn: "arn", conversationState: { ...base.conversationState, conversationId: "b" } }));
  assert.notEqual(k, await responseKey({ conversationState: { conversationId: "a", currentMessage: { userInputMessage: { content: "y" } } } }));
});

test("entries expire and are bounded", () => {
  let now = 0;
  const cache = new ResponseCache(() => now);
  cache.begin("a", 1000)(answer());
  assert.equal(cache.get("a")?.text, "hi");
  now = 1000;
  assert.equal(cache.get("a"), undefined);
  for (let i = 0; i < 40; i++) cache.begin("k" + i, 1000)(answer());
  assert.equal(cache.size, 32);
  assert.equal(cache.get("k0"), undefined);
  assert.ok(cache.get("k39"));
  cache.begin("big", 1000)(answer("x".repeat(3 * 1024 * 1024)));
  assert.equal(cache.get("big"), undefined);
});

test("waiters get the running request's answer, or null when it fails", async () => {
  const cache = new ResponseCache();
  const settle = cache.begin("k", 1000);
  const waiting = cache.wait("k");
  settle(answer("done"));
  settle(null); // second call ignored
  assert.equal((await waiting)?.text, "done");
  assert.equal(await cache.wait("k"), null, "nothing in flight any more");
  const failing = cache.begin("f", 1000);
  const w = cache.wait("f");
  failing(null);
  assert.equal(await w, null);
  assert.equal(cache.get("f"), undefined);
});

test("restore round-trips a completion", () => {
  const c = restore(answer());
  assert.equal(c.text, "hi");
  assert.equal(c.tools[0].name, "Bash");
  assert.equal(c.outputTokens, 3);
  assert.equal(c.terminal, true);
});
