const $ = (id) => document.getElementById(id);
const number = (n, d = 0) =>
  Number(n ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: d });
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// Brand marks from @lobehub/icons (MIT); trademarks belong to their owners.
// Colour marks render as <img>; single-colour marks are CSS masks that follow the theme.
const COLOR_BRANDS = new Set(["kiro", "claude", "claude-code", "deepseek", "qwen", "gemini", "gemini-cli"]);
function brandIcon(brand) {
  return COLOR_BRANDS.has(brand)
    ? `<img src="/brands/${brand}.svg" alt="" loading="lazy" />`
    : `<i class="mono" data-brand="${brand}"></i>`;
}
const CLIENTS = {
  "claude-code": { label: "Claude Code", brand: "claude-code" },
  "claude-code-ide": { label: "Claude Code (IDE)", brand: "claude-code" },
  cursor: { label: "Cursor", brand: "cursor" },
  cline: { label: "Cline", brand: "cline" },
  "roo-code": { label: "Roo Code", brand: "roo-code" },
  "kilo-code": { label: "Kilo Code", brand: "kilo-code" },
  continue: { label: "Continue", glyph: "Co" },
  opencode: { label: "opencode", brand: "opencode" },
  aider: { label: "Aider", glyph: "Ai" },
  "gemini-cli": { label: "Gemini CLI", brand: "gemini-cli" },
  openrouter: { label: "OpenRouter", brand: "openrouter" },
  "anthropic-sdk": { label: "Anthropic SDK", brand: "anthropic" },
  "openai-sdk": { label: "OpenAI SDK", brand: "openai" },
  curl: { label: "curl", glyph: "$" },
  other: { label: "Khác", glyph: "?" },
};
const agent = (id) => CLIENTS[id] ?? CLIENTS.other;
function agentBadge(id, size = "") {
  const a = agent(id);
  return `<span class="agent ${size}" title="${esc(a.label)}" aria-hidden="true">${a.brand ? brandIcon(a.brand) : esc(a.glyph)}</span>`;
}
const PROVIDER_LABELS = { kiro: "Kiro", openrouter: "OpenRouter", deploy: "deploy.com" };
const MODEL_BRANDS = [
  [/claude|sonnet|opus|haiku/i, "claude"],
  [/deepseek/i, "deepseek"],
  [/qwen/i, "qwen"],
  [/gemini/i, "gemini"],
  [/(^|\/)(gpt|o\d|chatgpt)|openai/i, "openai"],
  [/^openrouter\//i, "openrouter"],
];
function modelBrand(model) {
  return MODEL_BRANDS.find(([pattern]) => pattern.test(model ?? ""))?.[1];
}
function modelMark(model) {
  const brand = modelBrand(model);
  return brand ? `<span class="model-mark">${brandIcon(brand)}</span>` : "";
}

let signedIn = false,
  current = "overview",
  page = 1,
  settings = null,
  overviewGeneration = 0,
  requestGeneration = 0,
  toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5000);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/session") showLogin();
    throw new Error(data.error?.message ?? `HTTP ${response.status}`);
  }
  return data;
}
function showLogin() {
  signedIn = false;
  $("app").hidden = true;
  $("login-screen").hidden = false;
}
async function showApp() {
  signedIn = true;
  $("login-screen").hidden = true;
  $("app").hidden = false;
  $("password").value = "";
  $("base-url").textContent = location.origin + "/v1";
  await route();
}
function empty(message, detail = "") {
  return `<div class="empty"><span class="empty-icon">◌</span><strong>${esc(message)}</strong><span>${esc(detail)}</span></div>`;
}
function stateBadge(s) {
  $("gateway-status").textContent = s.enabled
    ? "Gateway đang bật"
    : "Gateway tạm dừng";
  $("gateway-status").classList.toggle("paused", !s.enabled);
}
function rangeQuery() {
  return "days=" + $("range").value;
}
function requestQuery() {
  const q = new URLSearchParams({
    days: $("range").value,
    status: $("status-filter").value,
    page: String(page),
  });
  if ($("model-filter").value) q.set("model", $("model-filter").value);
  return q.toString();
}
async function loadOverview() {
  const generation = ++overviewGeneration;
  const data = await api("/api/overview?" + rangeQuery());
  if (generation !== overviewGeneration || !signedIn) return;
  settings = data.settings;
  stateBadge(settings);
  const t = data.totals;
  $("metric-requests").textContent = number(t.requests);
  $("metric-success").textContent =
    `${number(t.successful)} thành công · ${number(t.failed)} lỗi · ${number(t.active)} đang xử lý`;
  $("metric-tokens").textContent = number(t.input_tokens + t.output_tokens);
  $("metric-token-source").textContent =
    `${number(t.input_tokens)} input / ${number(t.output_tokens)} output · ${number(t.estimated_token_requests)} request ước tính`;
  $("metric-estimated").textContent = number(t.estimated_credits, 5);
  $("metric-reported").textContent =
    t.reported_credits === null ? "—" : number(t.reported_credits, 5);
  $("metric-coverage").textContent =
    `Có số liệu ở ${number(t.reported_requests)} / ${number(t.requests)} request`;
  $("latency").textContent =
    `Độ trễ trung bình ${number(t.avg_latency / 1000, 2)} giây`;
  $("updated").textContent =
    "Cập nhật " + new Date(data.generatedAt).toLocaleTimeString("vi-VN");
  $("budget-used").textContent = number(data.month.estimated_credits, 4);
  $("budget-limit").textContent = settings.monthlyCreditBudget
    ? number(settings.monthlyCreditBudget, 2) + " credit"
    : "Chưa thiết lập";
  $("budget-progress").value = settings.monthlyCreditBudget
    ? Math.min(
        100,
        (data.month.estimated_credits / settings.monthlyCreditBudget) * 100,
      )
    : 0;
  renderChart(data);
  $("model-list").innerHTML = data.models.length
    ? data.models
        .map(
          (m) =>
            `<div class="model-row"><span class="model-icon">${modelBrand(m.model) ? brandIcon(modelBrand(m.model)) : "✳"}</span><div><strong>${esc(m.model)}</strong><small>${number(m.input_tokens + m.output_tokens)} token · ${number(m.estimated_credits, 4)} credit quy đổi</small></div><span>${number(m.requests)} req</span></div>`,
        )
        .join("")
    : empty(
        "Chưa có request",
        "Gửi request đầu tiên tới gateway để xem thống kê.",
      );
  $("agent-list").innerHTML = (data.clients ?? []).length
    ? data.clients
        .slice(0, 6)
        .map(
          (c) =>
            `<div class="model-row">${agentBadge(c.client)}<div><strong>${esc(agent(c.client).label)}</strong><small>${number(c.tokens)} token${c.failed ? ` · ${number(c.failed)} lỗi` : ""}</small></div><span>${number(c.requests)} req</span></div>`,
        )
        .join("")
    : empty(
        "Chưa có agent nào gọi",
        "Trỏ Claude Code, Cursor hoặc SDK tới base URL trong Cài đặt.",
      );
  calculate();
}
function renderChart(data) {
  if (!data.totals.requests) {
    $("chart").innerHTML = empty(
      "Gateway đã sẵn sàng ghi nhận",
      "Lưu lượng sẽ xuất hiện sau request đầu tiên.",
    );
    return;
  }
  const rows = [];
  const now = new Date();
  for (let n = data.days; n >= 0; n--) {
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n),
    )
      .toISOString()
      .slice(0, 10);
    rows.push(
      data.series.find((s) => s.day === day) ?? { day, requests: 0, failed: 0 },
    );
  }
  const w = 650,
    h = 170,
    left = 30,
    right = 12,
    top = 8,
    bottom = 26,
    max = Math.max(4, Math.ceil(Math.max(...rows.map((r) => r.requests)) / 4) * 4),
    x = (i) => left + (i * (w - left - right)) / Math.max(1, rows.length - 1),
    y = (v) => h - bottom - (v * (h - top - bottom)) / max;
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Request và lỗi theo ngày UTC">`;
  for (let i = 0; i <= 4; i++) {
    const yy = y((max * i) / 4);
    svg += `<line class="c-grid" x1="${left}" y1="${yy}" x2="${w - right}" y2="${yy}"/><text x="0" y="${yy + 3}">${Math.round((max * i) / 4)}</text>`;
  }
  const points = rows.map((r, i) => `${x(i)},${y(r.requests)}`).join(" ");
  // Errors as bars so they stay visible when every request failed.
  const barW = Math.max(3, Math.min(12, ((w - left - right) / Math.max(1, rows.length - 1)) * 0.4));
  rows.forEach((r, i) => {
    if (r.failed)
      svg += `<rect class="c-err" x="${x(i) - barW / 2}" y="${y(r.failed)}" width="${barW}" height="${h - bottom - y(r.failed)}" rx="2"><title>${esc(r.day)}: ${r.failed} lỗi</title></rect>`;
  });
  svg += `<polygon class="c-area" points="${left},${h - bottom} ${points} ${w - right},${h - bottom}"/><polyline class="c-line" points="${points}"/>`;
  rows.forEach((r, i) => {
    svg += `<circle class="c-dot" cx="${x(i)}" cy="${y(r.requests)}" r="3"><title>${esc(r.day)}: ${r.requests} request, ${r.failed} lỗi</title></circle>`;
    if (
      i === 0 ||
      i === rows.length - 1 ||
      i % Math.max(1, Math.ceil(rows.length / 6)) === 0
    )
      svg += `<text x="${x(i)}" y="${h - 5}" text-anchor="middle">${r.day.slice(8)}/${r.day.slice(5, 7)}</text>`;
  });
  $("chart").innerHTML = svg + "</svg>";
}
function calculate() {
  if (!settings) return;
  const input = Number($("calc-input").value),
    output = Number($("calc-output").value);
  $("calc-result").textContent =
    Number.isFinite(input) &&
    Number.isFinite(output) &&
    input >= 0 &&
    output >= 0
      ? number(
          (input * settings.inputCreditsPerMillion +
            output * settings.outputCreditsPerMillion) /
            1e6,
          6,
        )
      : "—";
  $("calc-rate").textContent =
    `1 triệu token: ${number(settings.inputCreditsPerMillion, 4)} input / ${number(settings.outputCreditsPerMillion, 4)} output credit. ${settings.inputCreditsPerMillion === 0 && settings.outputCreditsPerMillion === 0 ? "Đặt tỷ lệ trong Cài đặt để bắt đầu quy đổi." : ""}`;
}
async function loadRequests() {
  const generation = ++requestGeneration;
  const data = await api("/api/requests?" + requestQuery());
  if (generation !== requestGeneration || !signedIn) return;
  $("request-total").textContent = number(data.total) + " request";
  $("page-info").textContent =
    `Trang ${data.page} / ${Math.max(1, Math.ceil(data.total / data.pageSize))}`;
  $("prev").disabled = page <= 1;
  $("next").disabled = page * data.pageSize >= data.total;
  $("request-rows").innerHTML = data.items.length
    ? data.items
        .map(
          (r) =>
            `<tr><td><div class="who">${agentBadge(r.client, "sm")}<div><span title="${esc(r.id)}">${esc(agent(r.client).label)}</span><small>${esc(new Date(r.started).toLocaleString("vi-VN"))}</small></div></div></td><td data-label="Model">${modelMark(r.model)}${esc(r.model || "—")}<small>${esc(PROVIDER_LABELS[r.provider] ?? "Kiro")} · ${r.streamed ? "Streaming" : "JSON"} · ${r.endpoint.includes("messages") ? "Anthropic" : "OpenAI"}</small></td><td data-label="Trạng thái"><span class="status ${r.status === 0 ? "pending" : r.status >= 400 ? "error-status" : ""}">${r.status === 0 ? "Đang xử lý" : r.status}</span>${r.error_code ? `<small>${esc(r.error_code)}</small>` : ""}</td><td data-label="Input / output">${number(r.input_tokens)} / ${number(r.output_tokens)}<small>${r.input_source === "reported" ? "Input báo cáo" : r.input_source === "estimated" ? "Input ước tính" : "Input chưa có"} · ${r.output_source === "reported" ? "output báo cáo" : r.output_source === "estimated" ? "output ước tính" : "output chưa có"}</small></td><td data-label="Quy đổi / Kiro">${number(r.estimated_credits, 5)} / ${r.reported_credits === null ? "—" : number(r.reported_credits, 5)}<small>${r.cost_usd == null ? "credit" : "credit · $" + number(r.cost_usd, 6)}</small></td><td data-label="Độ trễ">${r.status === 0 ? "—" : number(r.latency / 1000, 2) + " s"}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="6">${empty("Chưa có request phù hợp", "Thử thay đổi khoảng thời gian hoặc bộ lọc.")}</td></tr>`;
}
async function loadSettings(fillForm = true) {
  const data = await api("/api/settings");
  settings = data.settings;
  stateBadge(settings);
  const form = $("settings-form");
  if (fillForm)
    for (const [key, value] of Object.entries(settings)) {
      const input = form.elements.namedItem(key);
      if (!input) continue;
      if (key === "enabled") input.checked = value;
      else input.value = key === "models" ? value.join("\n") : value;
    }
  $("secret-list").innerHTML = Object.entries(data.secrets)
    .map(
      ([name, present]) =>
        `<div class="secret-row"><code>${esc(name)}</code><span class="secret-state ${present ? "" : "missing"}">${present ? "✓ Đã cấu hình" : "○ Chưa có"}</span></div>`,
    )
    .join("");
  const selected = $("model-filter").value;
  $("model-filter").innerHTML =
    '<option value="">Mọi model</option>' +
    settings.models
      .map((m) => `<option value="${esc(m)}">${esc(m)}</option>`)
      .join("");
  if (settings.models.includes(selected)) $("model-filter").value = selected;
}
async function route() {
  if (!signedIn) return;
  current = ["overview", "requests", "settings"].includes(
    location.hash.slice(1),
  )
    ? location.hash.slice(1)
    : "overview";
  const labels = {
    overview: ["Tổng quan", "Lưu lượng và chi phí, trong cùng một góc nhìn."],
    requests: ["Lịch sử request", "Theo dõi từng lần gọi và số liệu sử dụng."],
    settings: ["Cài đặt", "Cấu hình gateway theo cách bạn làm việc."],
  };
  for (const element of document.querySelectorAll(".page"))
    element.hidden = element.id !== current;
  document
    .querySelectorAll("nav a")
    .forEach((a) => a.classList.toggle("active", a.dataset.page === current));
  $("page-title").textContent = $("page-name").textContent = labels[current][0];
  $("page-description").textContent = labels[current][1];
  $("range-controls").hidden = current === "settings";
  try {
    if (current === "overview") await loadOverview();
    else if (current === "requests") {
      await loadSettings(false);
      await loadRequests();
    } else await loadSettings();
  } catch (error) {
    toast(error.message);
  }
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("login-error").textContent = "";
  try {
    await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ password: $("password").value }),
    });
    await showApp();
  } catch (error) {
    $("login-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/session", { method: "DELETE" });
    showLogin();
  } catch (error) {
    toast(error.message);
  }
});
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!settings) return;
  const data = new FormData(event.currentTarget),
    next = { ...settings };
  for (const key of Object.keys(next))
    next[key] =
      key === "enabled"
        ? data.has(key)
        : key === "models"
          ? String(data.get(key))
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : key === "apiRegion"
            ? String(data.get(key)).trim()
            : Number(data.get(key));
  event.submitter.disabled = true;
  $("save-status").textContent = "Đang lưu…";
  try {
    const result = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify(next),
    });
    settings = result.settings;
    stateBadge(settings);
    $("save-status").textContent = "Đã lưu cài đặt";
    toast("Đã cập nhật. Tỷ lệ mới áp dụng cho request tiếp theo.");
  } catch (error) {
    $("save-status").textContent = "Chưa lưu được";
    toast(error.message);
  } finally {
    event.submitter.disabled = false;
  }
});
$("refresh").addEventListener("click", async () => {
  const button = $("refresh");
  button.disabled = true;
  try {
    await (current === "requests" ? loadRequests() : loadOverview());
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
$("range").addEventListener("change", () => {
  page = 1;
  route();
});
for (const id of ["status-filter", "model-filter"])
  $(id).addEventListener("change", () => {
    page = 1;
    loadRequests().catch((e) => toast(e.message));
  });
$("prev").addEventListener("click", () => {
  if (page > 1) page--;
  loadRequests().catch((e) => toast(e.message));
});
$("next").addEventListener("click", () => {
  page++;
  loadRequests().catch((e) => toast(e.message));
});
for (const id of ["calc-input", "calc-output"])
  $(id).addEventListener("input", calculate);
$("copy-url").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.origin + "/v1");
    toast("Đã sao chép base URL.");
  } catch {
    toast("Không thể sao chép. Bạn có thể chọn và copy URL ở trên.");
  }
});
$("reset-vault").addEventListener("click", async () => {
  if (
    !confirm(
      "Xóa token đã refresh đang lưu? Gateway sẽ dùng lại KIRO_CREDENTIALS ở request tiếp theo.",
    )
  )
    return;
  try {
    await api("/api/vault/reset", { method: "POST" });
    toast("Đã reset token vault.");
  } catch (error) {
    toast(error.message);
  }
});
$("export").addEventListener("click", async () => {
  const button = $("export");
  button.disabled = true;
  try {
    const response = await fetch("/api/export?" + requestQuery());
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message ?? "Xuất CSV thất bại.");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "tg-gateway-requests.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
window.addEventListener("hashchange", route);
setInterval(() => {
  if (signedIn && !document.hidden && current !== "settings")
    (current === "overview" ? loadOverview() : loadRequests()).catch((error) =>
      toast(error.message),
    );
}, 30000);
api("/api/session")
  .then(showApp)
  .catch(() => showLogin());

function syncThemeButtons() {
  const choice = document.documentElement.dataset.themeChoice || "light";
  for (const button of document.querySelectorAll("[data-theme-value]"))
    button.setAttribute("aria-pressed", String(button.dataset.themeValue === choice));
}
for (const button of document.querySelectorAll("[data-theme-value]"))
  button.addEventListener("click", () => {
    window.tgSetTheme?.(button.dataset.themeValue);
    syncThemeButtons();
  });
syncThemeButtons();
