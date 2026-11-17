import { test } from "node:test";
import assert from "node:assert/strict";
import { Trace, Capture } from "../src/trace.ts";

test("trace orders steps and measures begin/end", () => {
  let now = 1000; const t = new Trace(now, () => now);
  t.mark("received", "done");
  now = 1005; const end = t.begin("upstream", "q.x"); now = 1100; end();
  const open = t.begin("stream"); now = 1300;
  void open;
  assert.deepEqual(t.steps(), [
    { key: "received", state: "done", at: 0, dur: null, detail: "" },
    { key: "upstream", state: "done", at: 5, dur: 95, detail: "q.x" },
    { key: "stream", state: "active", at: 100, dur: 200, detail: "" },
  ]);
});
test("trace closer can set state and detail; closing twice is a no-op", () => {
  let now = 0; const t = new Trace(now, () => now);
  const end = t.begin("upstream", "h"); now = 7; end("error", "upstream_http_429"); now = 20; end();
  assert.deepEqual(t.steps(), [{ key: "upstream", state: "error", at: 0, dur: 7, detail: "upstream_http_429" }]);
});
test("capture cuts at the byte limit and flags truncation", () => {
  const c = new Capture(8); c.setRequest("abcdefghij"); c.append("xy");
  assert.deepEqual(c.result(), { request: "abcdefgh", response: "xy", truncated: true });
});
test("capture never splits a multi-byte character", () => {
  const c = new Capture(4); c.setRequest("ảảả"); // 3 bytes each
  assert.equal(c.result().request, "ả");
});
test("capture appends across chunks up to the limit", () => {
  const c = new Capture(5); c.append("abc"); c.append("def"); c.append("g");
  assert.deepEqual(c.result(), { request: null, response: "abcde", truncated: true });
  const d = new Capture(); d.setRequest("{}"); d.append("ok");
  assert.deepEqual(d.result(), { request: "{}", response: "ok", truncated: false });
});
