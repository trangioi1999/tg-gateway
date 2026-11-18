import ActionIcon from "./ActionIcon";
import Button from "./Button";
import Seg from "./Seg";
import { useMemo, useRef, useState, useEffect } from "react";
import { formatJson, highlightLines } from "../lib/highlight";
import { assemble } from "../../../src/stream-text.ts";

type View = "formatted" | "raw";

/**
 * Captured request/response. Shown formatted by default: JSON indented (even when cut at
 * the capture limit), an SSE stream assembled into the final message. "Gốc" shows the bytes.
 */
export default function CodeBox({
  name,
  text,
  sse: streamed = false,
}: {
  name: string;
  text: string;
  sse?: boolean;
}) {
  const [wrap, setWrap] = useState(true),
    [view, setView] = useState<View>("formatted"),
    [message, setMessage] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  // A streamed request that failed before streaming answers with a plain JSON error.
  const sse = streamed && /^(event|data):/m.test(text);
  const formatted = useMemo(() => {
    if (!sse) return formatJson(text);
    const message = assemble(text);
    return message ? JSON.stringify(message, null, 2) : text;
  }, [text, sse]);
  const raw = view === "raw";
  const display = raw ? text : formatted;
  const html = useMemo(() => highlightLines(display, raw && sse), [display, raw, sse]);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setMessage("");
    }, 2000);
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
    } finally {
      setCopying(false);
    }
  }
  return (
    <div className="codebox">
      <div className="codebar">
        <span className="fn">
          <b>{raw && sse ? name : name.replace(/\.sse$/, ".json")}</b>
          <span>
            {(new Blob([text]).size / 1024).toLocaleString("vi-VN", {
              maximumFractionDigits: 1,
            })}{" "}
            KB · {display.split("\n").length} dòng
          </span>
        </span>
        <span className="acts">
          <Seg
            label="Kiểu hiển thị"
            value={view}
            onChange={setView}
            options={[
              ["formatted", sse ? "Đã ghép" : "Định dạng"],
              ["raw", sse ? "SSE gốc" : "Gốc"],
            ]}
          />
          <button className="ib" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            <ActionIcon name="wrap" />
            Xuống dòng
          </button>
          <Button className="ib copy-button" loading={copying} onClick={copy}>
            <ActionIcon name={copied ? "check" : "copy"} />
            {copied ? "Đã chép" : "Sao chép"}
          </Button>
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
