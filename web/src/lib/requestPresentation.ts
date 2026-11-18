import type { RequestRow } from "../../../src/dashboard/contract.ts";
import { fmtCompact } from "./format.ts";
export function requestDate(started: number, now = new Date()) {
  const date = new Date(started);
  return date.toDateString() === now.toDateString() ? "Hôm nay" : `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}
export function requestStatus(r: Pick<RequestRow, "status" | "error_code" | "optimizations">) {
  const tags = r.optimizations.split(",");
  // One vocabulary for the column; the raw code is the tooltip (and in the detail view).
  if (r.status === 0) return { tone: "run", label: "Đang chạy", detail: "Đang chạy" };
  const code = [String(r.status), r.error_code].filter(Boolean).join(" · ");
  if (r.error_code === "cancelled") return { tone: "err", label: "Đã dừng", detail: code };
  if (r.status >= 400) return { tone: "err", label: "Lỗi " + r.status, detail: code };
  const how = tags.includes("cache_hit") ? " · trả từ cache" : tags.includes("local_reply") ? " · trả tại gateway" : "";
  return { tone: "ok", label: "Thành công", detail: code + how };
}
export function savingTags(optimizations: string, saved: number) {
  return [...new Set(optimizations.split(",").filter(Boolean).map(tag => {
    if (tag.startsWith("cleared:")) return `clear${saved > 0 ? " −" + fmtCompact(saved) : ""}`;
    if (tag === "compact_new" || tag === "compact") return "compact";
    if (tag === "cache_hit") return "cache";
    if (tag === "local_reply") return "local";
    if (tag === "auto_mode_model") return "model rẻ";
    if (tag.startsWith("tools_dropped:")) return "bỏ " + tag.slice(14) + " tool";
    return tag;
  }))];
}
/** What each credit-saving step did, for the tooltip of the "Tiết kiệm" column. */
export function savingDetails(optimizations: string): string[] {
  return [...new Set(optimizations.split(",").filter(Boolean).map(tag => {
    if (tag.startsWith("cleared:")) return `Xóa ${tag.slice(8)} kết quả tool cũ khỏi context`;
    if (tag === "compact_new") return "Nén context: tạo bản tóm tắt mới cho phần đầu hội thoại";
    if (tag === "compact") return "Nén context: dùng lại bản tóm tắt đã có";
    if (tag === "cache_hit") return "Trả lời từ cache, không gọi lên nhà cung cấp";
    if (tag === "local_reply") return "Trả lời tại gateway (request kiểm tra quota max_tokens=1)";
    if (tag === "auto_mode_model") return "Phân loại auto mode chạy bằng model rẻ hơn";
    if (tag.startsWith("tools_dropped:")) return `Không gửi ${tag.slice(14)} định nghĩa tool (Cài đặt → Tiết kiệm credit)`;
    return tag;
  }))];
}
export function requestSource(r: Pick<RequestRow, "ip" | "city" | "country">) {
  const local = !!r.ip && /^(::1|127\.|localhost$|local$|::ffff:127\.)/.test(r.ip);
  return { place: [r.city, r.country].filter(Boolean).join(", ") || (local ? "local" : "—"), ip: local ? "local" : r.ip || "—" };
}
const agents: Record<string, string> = {
  main: "Phiên chính",
  background: "Nền",
  subagent: "Subagent",
  "auto-mode": "Phân loại auto mode",
};
/** Agent that sent the request (see detectAgent): built-in kinds translated, markers as written. */
export const agentLabel = (agent: string | null) => (agent ? agents[agent] ?? agent : "");
