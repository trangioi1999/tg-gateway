import { useSyncExternalStore } from "react";
import { inFlight } from "../api/inFlight";
export default function ProgressBar() {
  const visible = useSyncExternalStore(inFlight.subscribe, inFlight.getSnapshot);
  return visible ? <div className="top-progress" role="progressbar" aria-label="Đang tải dữ liệu" /> : null;
}
