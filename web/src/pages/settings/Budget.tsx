import Row from "../../components/Row";
import type { SectionProps } from "./types";
export default function Budget({ draft, set }: SectionProps) {
  return (
    <>
      <div className="group">
        <h3>Quy đổi credit nội bộ</h3>
        <div className="rows">
          {(
            [
              ["inputCreditsPerMillion", "Credit / 1M input token"],
              ["outputCreditsPerMillion", "Credit / 1M output token"],
            ] as const
          ).map(([key, label]) => (
            <Row key={key} label={label}>
              <input
                aria-label={label}
                type="number"
                min={0}
                max={1e9}
                step="any"
                value={draft[key]}
                onChange={(e) => set(key, e.target.value === "" ? "" : Number(e.target.value))}
              />
            </Row>
          ))}
          <div className="rowi">
            <span className="mono">
              credit = (input × {draft.inputCreditsPerMillion} + output ×{" "}
              {draft.outputCreditsPerMillion}) / 1.000.000
            </span>
          </div>
        </div>
      </div>
      <div className="group">
        <h3>Mục tiêu</h3>
        <div className="rows">
          <Row
            label="Mục tiêu credit / tháng"
            note="0 = bỏ mục tiêu. Không chặn request."
          >
            <input
              aria-label="Mục tiêu credit / tháng"
              type="number"
              min={0}
              max={1e9}
              step="any"
              value={draft.monthlyCreditBudget}
              onChange={(e) =>
                set("monthlyCreditBudget", e.target.value === "" ? "" : Number(e.target.value))
              }
            />
          </Row>
        </div>
      </div>
    </>
  );
}
