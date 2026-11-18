import { fmtCompact, fmtInt } from "../lib/format";
/** Estimated tokens per part of a Kiro request (see contextBreakdown in src/context.ts). */
export interface ContextSizes {
  system: number;
  tools: number;
  messages: number;
  toolResults: number;
  toolInputs: number;
  current: number;
  total: number;
  saved: number;
  /** Tools the client sent, largest first; `dropped` = not sent (Settings). */
  toolList?: { name: string; tokens: number; dropped?: boolean }[];
}
type Part = "system" | "tools" | "messages" | "toolResults" | "toolInputs" | "current";
const parts: [Part, string, string][] = [
  ["system", "System prompt", "Hướng dẫn của client (Claude Code), CLAUDE.md, memory"],
  ["tools", "Định nghĩa tool", "Tool có sẵn và MCP; gửi lại ở mọi request"],
  ["messages", "Tin nhắn cũ", "Lời bạn và câu trả lời của model ở các lượt trước"],
  ["toolResults", "Kết quả tool cũ", "Output file/lệnh của các lượt trước (phần gateway có thể xóa)"],
  ["toolInputs", "Tham số tool cũ", "Nội dung Write/Edit/lệnh đã gọi ở các lượt trước"],
  ["current", "Lượt hiện tại", "Tin nhắn mới và kết quả tool vừa chạy (không bị cắt)"],
];
export function parseContext(json: string | null): ContextSizes | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ContextSizes;
  } catch {
    return null;
  }
}
export default function ContextBars({ sizes }: { sizes: ContextSizes }) {
  const sum = Math.max(1, parts.reduce((n, [k]) => n + (sizes[k] ?? 0), 0));
  return (
    <div>
      <div className="sec-t">
        <h3>Context gửi lên Kiro</h3>
        <span>
          ≈ {fmtInt(sizes.total)} token{sizes.saved > 0 && <> · gateway đã cắt {fmtCompact(sizes.saved)}</>}
        </span>
      </div>
      <div className="ctx">
        <div className="ctx-bar" role="img" aria-label="Tỷ lệ từng phần của context">
          {parts.map(([k], i) =>
            sizes[k] > 0 ? <i key={k} className={"c" + i} style={{ width: `${(sizes[k] / sum) * 100}%` }} /> : null,
          )}
        </div>
        <ul className="ctx-list">
          {parts.map(([k, label, hint], i) => (
            <li key={k} title={hint}>
              <span className={"dot c" + i} aria-hidden="true" />
              <span className="nm">{label}<small>{hint}</small></span>
              <span className="num">{fmtCompact(sizes[k] ?? 0)}</span>
              <span className="pct num">{Math.round(((sizes[k] ?? 0) / sum) * 100)}%</span>
            </li>
          ))}
        </ul>
        {!!sizes.toolList?.length && <ToolList tools={sizes.toolList} />}
        <p className="hint">Ước tính theo số byte / 4, chỉ lưu con số, không lưu nội dung.</p>
      </div>
    </div>
  );
}

/** Tools in two groups, sent and not sent (Settings → tool list), each with its token total. */
function ToolList({ tools }: { tools: NonNullable<ContextSizes["toolList"]> }) {
  const sent = tools.filter((t) => !t.dropped), dropped = tools.filter((t) => t.dropped);
  const max = Math.max(1, ...tools.map((t) => t.tokens));
  const total = (list: typeof tools) => list.reduce((n, t) => n + t.tokens, 0);
  const group = (list: typeof tools, title: string, note: string, kind: "sent" | "dropped") =>
    list.length > 0 && (
      <section className={"tg " + kind}>
        <h4>
          <span className="tg-dot" aria-hidden="true" />
          {title} <b className="num">{list.length}</b>
          <span className="tg-note">{note} {fmtCompact(total(list))} token</span>
        </h4>
        <ul>
          {list.map((t) => (
            <li key={t.name} title={`${t.name} · ≈ ${fmtInt(t.tokens)} token`}>
              <span className="mono">{t.name}</span>
              <span className="tg-bar" aria-hidden="true"><i style={{ width: `${(t.tokens / max) * 100}%` }} /></span>
              <span className="num">{fmtCompact(t.tokens)}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <details className="ctx-tools">
      <summary>
        Từng tool <span className="num">{tools.length}</span>
        {dropped.length > 0 && <span className="tag save">bỏ {dropped.length} · −{fmtCompact(total(dropped))} token</span>}
      </summary>
      <div className="tg-wrap">
        {group(sent, "Đã gửi", "", "sent")}
        {group(dropped, "Không gửi", "tiết kiệm", "dropped")}
      </div>
    </details>
  );
}
