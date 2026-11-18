import type { Step } from "../../../src/dashboard/contract.ts";
import { clientLabel } from "./brands.ts";
import { fmtMs } from "./format.ts";

/** Translate presentation only; keep server trace codes unchanged. */
export function presentStep(step: Step): Step {
  let detail = step.detail;
  let state = step.state;
  if (step.key === "optimize") {
    const labels: Record<string, string> = {
      below_threshold: "Không cần: prompt dưới ngưỡng",
      not_kiro: "Chỉ áp dụng cho Kiro",
      compact: "Dùng bản tóm tắt đã lưu",
      compact_new: "Tóm tắt phần đầu hội thoại",
      auto_mode_model: "Bộ phân loại auto mode chạy bằng model rẻ hơn",
    };
    detail = detail.split(" · ").map(code => {
      const cleared = /^cleared:(\d+)$/.exec(code);
      return cleared ? `Xóa ${cleared[1]} tool result cũ` : labels[code] ?? code;
    }).join(" · ");
  } else if (step.key === "cache") {
    if (detail === "miss") { detail = "Không có trong cache"; state = "skip"; }
    if (detail === "hit") detail = "Trả lời từ cache, không tính credit";
  } else if (step.key === "local" && detail === "max_tokens_1") {
    detail = "max_tokens = 1, trả lời tại chỗ";
  } else if (step.key === "received") {
    const [client, ...rest] = detail.split(" · ");
    detail = [clientLabel(client), ...rest].join(" · ");
  }
  return { ...step, detail, state };
}

export function stepDuration(step: Step): string {
  if (step.state === "pending" || step.state === "skip" || step.at === null) return "—";
  // Backend marks instant steps with dur=null; only an active step is still running.
  if (step.dur === null) return step.state === "active" ? "Đang chạy" : "<1 ms";
  return step.dur === 0 ? "<1 ms" : fmtMs(step.dur);
}
