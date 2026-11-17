import Seg from "./Seg";
import { comparisonText, periodLabel, stepPeriod, type PeriodValue } from "../lib/period";
export default function PeriodBar({
  value,
  onChange,
}: {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
}) {
  return (
    <div className="period">
      <Seg
        label="Chu kỳ"
        value={value.period}
        onChange={(period) => onChange({ ...value, period })}
        options={[
          ["day", "Ngày"],
          ["week", "Tuần"],
          ["month", "Tháng"],
        ]}
      />
      <div className="nav-date">
        <button
          aria-label="Kỳ trước"
          onClick={() => onChange(stepPeriod(value, -1))}
        >
          ‹
        </button>
        <span>{periodLabel(value)}</span>
        <button
          aria-label="Kỳ sau"
          onClick={() => onChange(stepPeriod(value, 1))}
        >
          ›
        </button>
      </div>
      <span className="cmp">
        {comparisonText(value).replace(/^so/, "So")}
      </span>
    </div>
  );
}
