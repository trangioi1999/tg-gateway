import { useEffect, useRef } from "react";
/**
 * Output of a running request as it streams (answer text, thinking, tool calls), like a CI
 * job log. Follows the end unless the reader scrolled up.
 */
export default function LiveLog({ text, bytes, running }: { text: string; bytes: number; running: boolean }) {
  const pre = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const el = pre.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div>
      <div className="sec-t">
        <h3>Output trực tiếp</h3>
        <span>
          {running ? "Đang nhận" : "Đã kết thúc"} · {(bytes / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} KB stream
        </span>
      </div>
      <pre
        ref={pre}
        className={"live-log" + (running ? " running" : "")}
        tabIndex={0}
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {text || (running ? "Đang chờ token đầu tiên…" : "Không có output")}
        {running && <span className="cursor" aria-hidden="true" />}
      </pre>
      <p className="hint">Chỉ giữ trong bộ nhớ khi request đang chạy, không lưu lại.</p>
    </div>
  );
}
