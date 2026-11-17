import ActionIcon from "./ActionIcon";
import Button from "./Button";
import { useMemo, useRef, useState, useEffect } from "react";
import { highlightLines, prettyJson } from "../lib/highlight";
export default function CodeBox({
  name,
  text,
  sse = false,
}: {
  name: string;
  text: string;
  sse?: boolean;
}) {
  const [wrap, setWrap] = useState(false),
    [message, setMessage] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  const display = useMemo(() => (sse ? text : prettyJson(text)), [text, sse]);
  const html = useMemo(
    () => highlightLines(display, sse),
    [display, sse],
  );
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => { setCopied(false); setMessage(""); }, 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setMessage("Đã sao chép");
    } catch {
      if (pre.current) {
        const range = document.createRange();
        range.selectNodeContents(pre.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setMessage("Đã chọn nội dung. Nhấn Ctrl+C / ⌘C để sao chép.");
    } finally { setCopying(false); }
  }
  return (
    <div className="codebox">
      <div className="codebar">
        <span className="fn">
          <b>{name}</b>
          <span>
            {(new Blob([text]).size / 1024).toLocaleString("vi-VN", {
              maximumFractionDigits: 1,
            })}{" "}
            KB · {display.split("\n").length} dòng
          </span>
        </span>
        <span className="acts">
          <button
            className="ib"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            <ActionIcon name="wrap" />Xuống dòng
          </button>
          <Button className="ib copy-button" loading={copying} onClick={copy}><ActionIcon name={copied ? "check" : "copy"} />{copied ? "Đã chép" : "Sao chép"}</Button>
        </span>
      </div>
      {message && (
        <p role="status" className="hint">
          {message}
        </p>
      )}
      <pre
        ref={pre}
        className={wrap ? "wrap" : ""}
        tabIndex={0}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
