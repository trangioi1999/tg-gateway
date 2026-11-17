import type { Period } from "../../../src/dashboard/contract.ts";
export interface PeriodValue {
  period: Period;
  anchor: string;
}
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function stepPeriod(value: PeriodValue, direction: number): PeriodValue {
  const d = new Date(value.anchor + "T12:00:00");
  if (value.period === "month") {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + direction);
    d.setDate(
      Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()),
    );
  } else d.setDate(d.getDate() + direction * (value.period === "week" ? 7 : 1));
  return { ...value, anchor: localDate(d) };
}
export function periodLabel({ period, anchor }: PeriodValue) {
  const d = new Date(anchor + "T12:00:00");
  if (period === "month") return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
  if (period === "day")
    return `${["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"][d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return `${d.getDate()}${d.getMonth() !== end.getMonth() ? "/" + (d.getMonth() + 1) : ""} – ${end.getDate()}/${end.getMonth() + 1}/${end.getFullYear()}`;
}
export function periodQuery(value: PeriodValue) {
  return `period=${value.period}&anchor=${value.anchor}&tz=${-new Date().getTimezoneOffset()}`;
}

/** Provider quota URL in the browser's time zone; refresh bypasses the 5-minute server cache. */
export function providersUrl(refresh = false) {
  return `/api/providers?tz=${-new Date().getTimezoneOffset()}${refresh ? "&refresh=1" : ""}`;
}

export function comparisonText(value: PeriodValue) {
  return value.period === "day" ? "so với hôm qua"
    : value.period === "week" ? "so với tuần trước"
    : `so với tháng ${new Date(stepPeriod(value, -1).anchor + "T12:00:00").getMonth() + 1}`;
}
