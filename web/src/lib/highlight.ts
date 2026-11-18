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

/**
 * Indents JSON without parsing it, so text cut at the capture limit (invalid JSON) is still
 * readable. Strings are copied unchanged; whitespace outside strings is normalized.
 */
export function indentJson(text: string, unit = "  "): string {
  let out = "",
    depth = 0,
    inString = false,
    escaped = false;
  const newline = () => "\n" + unit.repeat(Math.max(0, depth));
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "{" || c === "[") {
      // Keep empty containers on one line.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === (c === "{" ? "}" : "]")) {
        out += c + text[j];
        i = j;
        continue;
      }
      depth++;
      out += c + newline();
    } else if (c === "}" || c === "]") {
      depth--;
      out = out.replace(/[ \t]+$/, "");
      if (!/[{[]$/.test(out)) out += newline();
      out += c;
    } else if (c === ",") out += "," + newline();
    else if (c === ":") out += ": ";
    else if (!/\s/.test(c)) out += c;
  }
  return out;
}

/** Pretty JSON when the text parses, indented best-effort when it does not (truncated). */
export function formatJson(text: string): string {
  const trimmed = text.trim();
  if (!/^[{[]/.test(trimmed)) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return indentJson(trimmed);
  }
}
