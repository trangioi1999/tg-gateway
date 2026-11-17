import Button from "../../components/Button";
import { useRef, useState, useEffect } from "react";
import Row from "../../components/Row";
import type { SectionProps } from "./types";
export default function Connect({ secrets }: SectionProps) {
  const url = location.origin + "/v1",
    ref = useRef<HTMLElement>(null),
    [message, setMessage] = useState("");
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
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setMessage("Đã sao chép URL.");
    } catch {
      if (ref.current) {
        const range = document.createRange();
        range.selectNodeContents(ref.current);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
      setMessage("Đã chọn URL. Nhấn Ctrl+C / ⌘C để sao chép.");
    } finally { setCopying(false); }
  }
  return (
    <>
      <div className="group">
        <h3>Kết nối ứng dụng</h3>
        <div className="rows">
          <Row
            label="Base URL"
            note="OpenAI-compatible · Anthropic endpoint /v1/messages"
            stack
          >
            <code className="url" ref={ref}>
              {url}
            </code>
            <Button className="btn full copy-button" loading={copying} onClick={copy}>{copied ? "✓ Đã chép" : "Sao chép URL"}</Button>
            {message && <p role="status">{message}</p>}
          </Row>
        </div>
        <p className="note">API key là giá trị GATEWAY_API_KEY.</p>
      </div>
      <div className="group">
        <h3>Cloudflare Secrets</h3>
        <div className="rows">
          {Object.entries(secrets).map(([key, present]) => (
            <Row key={key} label={key}>
              <span className={"ok-dot" + (present ? "" : " miss")}>
                {present ? "Đã đặt" : "Chưa đặt"}
              </span>
            </Row>
          ))}
        </div>
      </div>
    </>
  );
}
