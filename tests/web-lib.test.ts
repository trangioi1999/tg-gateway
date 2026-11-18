import test from "node:test";
import assert from "node:assert/strict";
import { fmtCompact, fmtCredit, fmtMs, fmtDelta } from "../web/src/lib/format.ts";
import { clientLabel, brandOf } from "../web/src/lib/brands.ts";
import { CLIENTS } from "../src/clients.ts";
test("Vietnamese dashboard formatting", () => {
  assert.equal(fmtCredit(0.06), "0,06");
  assert.equal(fmtCompact(48_200_000), "48,2M");
  assert.equal(fmtMs(894), "894 ms");
  assert.equal(fmtMs(1904), "1,9 s");
  assert.equal(fmtDelta(118, 100), "+18%");
  assert.equal(fmtDelta(94, 100), "−6%");
  assert.equal(fmtDelta(5, 0), "—");
  assert.equal(clientLabel("roo-code"), "Roo Code");
});

test("every detected client has a label and known logos resolve", () => {
  for (const id of [...CLIENTS, "tg-gateway"])
    assert.ok(id === "curl" || clientLabel(id) !== id, `label for ${id}`);
  assert.equal(clientLabel("claude-code-ide"), "Claude Code (IDE)");
  assert.equal(clientLabel("other"), "Khác");
  assert.equal(clientLabel("tg-gateway"), "Gateway (compact)");
  assert.equal(brandOf("claude-code-ide"), "claude-code");
  assert.equal(brandOf("anthropic-sdk"), "anthropic");
  assert.equal(brandOf("openai-sdk"), "openai");
  assert.equal(brandOf("cursor"), "cursor");
  assert.equal(brandOf("curl"), null);
});

import {
  highlightJson,
  highlightSse,
  prettyJson,
} from "../web/src/lib/highlight.ts";
test("JSON and SSE highlighting escapes payload markup", () => {
  const html = highlightJson('{"a":1,"b":"x","c":true}');
  for (const token of [
    '<span class="tk-k">"a"</span>',
    '<span class="tk-n">1</span>',
    '<span class="tk-s">"x"</span>',
    '<span class="tk-b">true</span>',
  ])
    assert.ok(html.includes(token));
  assert.ok(highlightJson('{"x":"<b>"}').includes("&lt;b&gt;"));
  assert.ok(
    highlightSse('event: ping\ndata: {"k":1}').includes(
      '<span class="tk-e">event:</span>',
    ),
  );
  assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(prettyJson("nope"), "nope");
  assert.ok(
    !highlightSse("data: <script>alert(1)</script>").includes("<script>"),
  );
});

import { localDate, periodLabel, stepPeriod } from "../web/src/lib/period.ts";
test("period controls preserve local calendar boundaries", () => {
  assert.equal(
    stepPeriod({ period: "month", anchor: "2026-01-31" }, 1).anchor,
    "2026-02-28",
  );
  assert.equal(
    stepPeriod({ period: "month", anchor: "2024-01-31" }, 1).anchor,
    "2024-02-29",
  );
  assert.equal(
    stepPeriod({ period: "week", anchor: "2026-11-17" }, -1).anchor,
    "2026-11-10",
  );
  assert.equal(
    stepPeriod({ period: "day", anchor: "2026-12-31" }, 1).anchor,
    "2027-01-01",
  );
  assert.equal(
    periodLabel({ period: "day", anchor: "2026-11-17" }),
    "Thứ Ba, 17/11/2026",
  );
  assert.equal(
    periodLabel({ period: "week", anchor: "2026-11-17" }),
    "16 – 22/11/2026",
  );
  assert.equal(
    periodLabel({ period: "month", anchor: "2026-11-17" }),
    "Tháng 11/2026",
  );
  assert.equal(localDate(new Date(2026, 10, 17, 23, 59)), "2026-11-17");
});
test("highlighter never interprets payload as HTML and preserves key whitespace", () => {
  const html = highlightJson(
    '{"x"  : "</span><img src=x onerror=alert(1)>", "y": "&"}',
  );
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;/span&gt;"));
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes('<span class="tk-p">  :</span>'));
  assert.ok(highlightSse("event: <svg onload=alert(1)>").includes("&lt;svg"));
});

import { highlightLines } from "../web/src/lib/highlight.ts";
import { comparisonText } from "../web/src/lib/period.ts";
test("multiline string tokens stay inside line wrappers and escape markup", () => {
  const payload = '{"text":"first\n</span><script>alert(1)</script>&last"}';
  for (const sse of [false, true]) {
    const html = highlightLines(payload, sse);
    const lines = html.split('<span class="ln">').slice(1);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      // Each wrapper closes after all of its own token spans.
      let depth = 1;
      const tags = line.match(/<span\b[^>]*>|<\/span>/g) ?? [];
      tags.forEach((tag, index) => {
        depth += tag === "</span>" ? -1 : 1;
        assert.ok(depth >= 0);
        if (depth === 0) assert.equal(index, tags.length - 1);
      });
      assert.equal(depth, 0);
    }
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&amp;"));
  }
  assert.ok(highlightLines('event: error\ndata: {"error":true}', true).includes('class="tk-e"'));
});
test("KPI and period comparisons share Vietnamese labels", () => {
  assert.equal(comparisonText({ period: "day", anchor: "2026-11-17" }), "so với hôm qua");
  assert.equal(comparisonText({ period: "week", anchor: "2026-11-17" }), "so với tuần trước");
  assert.equal(comparisonText({ period: "month", anchor: "2026-11-17" }), "so với tháng 10");
  assert.equal(comparisonText({ period: "month", anchor: "2026-01-17" }), "so với tháng 12");
});

import { requestDate, requestSource, requestStatus, savingTags } from "../web/src/lib/requestPresentation.ts";
test("request table presents HTTP, provider errors and replay status", () => {
  assert.deepEqual(requestStatus({ status: 0, error_code: null, optimizations: "" }), { tone: "run", label: "Đang chạy", detail: "Đang chạy" });
  assert.deepEqual(requestStatus({ status: 530, error_code: "kiro_http_530", optimizations: "" }), { tone: "err", label: "Lỗi 530", detail: "530 · kiro_http_530" });
  assert.equal(requestStatus({ status: 499, error_code: "cancelled", optimizations: "" }).label, "Đã dừng");
  assert.equal(requestStatus({ status: 429, error_code: null, optimizations: "" }).label, "Lỗi 429");
  assert.equal(requestStatus({ status: 200, error_code: null, optimizations: "cache_hit" }).detail, "200 · trả từ cache");
  assert.equal(requestStatus({ status: 200, error_code: null, optimizations: "local_reply" }).label, "Thành công");
});
test("request table derives savings, local sources and calendar dates", () => {
  assert.deepEqual(savingTags("cleared:8,compact_new,cache_hit,local_reply", 64000), ["clear −64K", "compact", "cache", "local"]);
  assert.deepEqual(savingTags("", 0), []);
  assert.deepEqual(savingTags("compact,compact_new", 1200), ["compact"]);
  assert.deepEqual(requestSource({ ip: "::1", city: null, country: null }), { place: "local", ip: "local" });
  assert.deepEqual(requestSource({ ip: "1.2.3.4", city: "Hà Nội", country: "VN" }), { place: "Hà Nội, VN", ip: "1.2.3.4" });
  const now = new Date(2026, 10, 18, 9);
  assert.equal(requestDate(new Date(2026, 10, 18, 1).getTime(), now), "Hôm nay");
  assert.equal(requestDate(new Date(2026, 10, 17, 23).getTime(), now), "17/11");
});
