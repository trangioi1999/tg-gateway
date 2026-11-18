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
        {!!sizes.toolList?.length && (
          <details className="ctx-tools">
            <summary>
              Từng tool ({sizes.toolList.length}
              {sizes.toolList.some((t) => t.dropped) && `, đã bỏ ${sizes.toolList.filter((t) => t.dropped).length}`})
            </summary>
            <ul>
              {sizes.toolList.map((t) => (
                <li key={t.name} className={t.dropped ? "dropped" : ""}>
                  <span className="mono">{t.name}</span>
                  {t.dropped && <span className="tag">không gửi</span>}
                  <span className="num">{fmtCompact(t.tokens)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="hint">Ước tính theo số byte / 4, chỉ lưu con số, không lưu nội dung.</p>
      </div>
    </div>
  );
}
