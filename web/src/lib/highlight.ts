const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function highlightJson(text: string): string {
  return escape(text).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g,
    (_match, str: string, col: string, kw: string, num: string, p: string) =>
      str
        ? col
          ? `<span class="tk-k">${str}</span><span class="tk-p">${col}</span>`
          : `<span class="tk-s">${str}</span>`
        : kw
          ? `<span class="tk-b">${kw}</span>`
          : num
            ? `<span class="tk-n">${num}</span>`
            : `<span class="tk-p">${p}</span>`,
  );
}
export function highlightSse(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.startsWith("event:")
        ? `<span class="tk-e">event:</span><span class="tk-k">${escape(line.slice(6))}</span>`
        : line.startsWith("data:")
          ? `<span class="tk-e">data:</span>${highlightJson(line.slice(5))}`
          : escape(line),
    )
    .join("\n");
}
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Highlight each line independently so token spans cannot cross line wrappers. */
export function highlightLines(text: string, sse = false): string {
  return text.split("\n")
    .map((line) => `<span class="ln">${(sse ? highlightSse(line) : highlightJson(line)) || " "}</span>`)
    .join("");
}
