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
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Generic glyph badges, one per agent family. Not vendor logos.
const CLIENTS = {
  "claude-code": { label: "Claude Code", glyph: ">_" },
  "claude-code-ide": { label: "Claude Code (IDE)", glyph: "</>" },
  cursor: { label: "Cursor", glyph: "↖" },
  cline: { label: "Cline", glyph: "Cl" },
  "roo-code": { label: "Roo Code", glyph: "Ro" },
  "kilo-code": { label: "Kilo Code", glyph: "Ki" },
  continue: { label: "Continue", glyph: "Co" },
  opencode: { label: "opencode", glyph: "oc" },
  aider: { label: "Aider", glyph: "Ai" },
  "anthropic-sdk": { label: "Anthropic SDK", glyph: "{A}" },
  "openai-sdk": { label: "OpenAI SDK", glyph: "{O}" },
  curl: { label: "curl", glyph: "$" },
  other: { label: "Khác", glyph: "?" },
};
function agent(id) {
  return CLIENTS[id] ?? CLIENTS.other;
}
function agentBadge(id, size = "") {
  const known = CLIENTS[id] ? id : "other";
  const a = CLIENTS[known];
  return `<span class="agent ${size}" data-agent="${known}" title="${esc(a.label)}" aria-hidden="true">${esc(a.glyph)}</span>`;
}

let signedIn = false,
  current = "overview",
  page = 1,
  settings = null,
  overviewGeneration = 0,
  requestGeneration = 0,
  animateOverview = true,
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
  animateOverview = true;
  $("login-screen").hidden = true;
  $("app").hidden = false;
  $("password").value = "";
  $("base-url").textContent = location.origin + "/v1";
  await route();
}
function empty(message, detail = "") {
  return `<div class="empty"><strong>${esc(message)}</strong><span>${esc(detail)}</span></div>`;
}

/** Count a number up from 0. Skipped for reduced motion and background refreshes. */
function countUp(el, value, digits = 0, suffix = "") {
  const final = number(value, digits) + suffix;
  if (!animateOverview || reduceMotion.matches || !Number.isFinite(value) || !value) {
    el.textContent = final;
    return;
  }
  const start = performance.now(),
    duration = 700;
  const step = (t) => {
    const p = Math.min(1, (t - start) / duration),
      eased = 1 - Math.pow(1 - p, 3);
    el.textContent = p < 1 ? number(value * eased, digits) + suffix : final;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function replay(el, className) {
  if (!animateOverview || reduceMotion.matches) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function stateBadge(s) {
  $("gateway-status").textContent = s.enabled
    ? "Gateway đang mở"
    : "Gateway tạm dừng";
  $("gateway-status").classList.toggle("paused", !s.enabled);
}
function rangeQuery() {
  return "days=" + $("range").value;
}
function rangeLabel() {
  return $("range").selectedOptions[0].textContent.toLowerCase();
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

function renderLane(t) {
  const lane = $("lane");
  const finished = t.successful + t.failed;
  const rate = finished ? (t.successful / finished) * 100 : null;
  lane.className = "lane";
  if (!settings.enabled) {
    lane.classList.add("paused");
    $("lane-title").textContent = "Gateway đang tạm dừng";
    $("lane-detail").textContent =
      "API trả 503 cho mọi request. Bật lại trong Cài đặt.";
  } else if (!t.requests) {
    lane.classList.add("idle");
    $("lane-title").textContent = "Gateway đang mở, chưa có request";
    $("lane-detail").textContent = `Không có lượt gọi nào trong ${rangeLabel()}.`;
  } else {
    if (rate !== null && rate < 90) lane.classList.add("warn");
    $("lane-title").textContent =
      rate !== null && rate < 90
        ? "Gateway đang mở, nhiều request lỗi"
        : "Gateway đang mở";
    $("lane-detail").textContent =
      `${number(t.requests)} request trong ${rangeLabel()}, độ trễ trung bình ${number(t.avg_latency / 1000, 2)} giây` +
      (t.active ? `, ${number(t.active)} đang chạy` : "");
  }
  if (rate === null) $("lane-rate").textContent = "—";
  else countUp($("lane-rate"), rate, rate < 100 ? 1 : 0, "%");
  replay(lane, "enter");
}

async function loadOverview() {
  const generation = ++overviewGeneration;
  const data = await api("/api/overview?" + rangeQuery());
  if (generation !== overviewGeneration || !signedIn) return;
  settings = data.settings;
  stateBadge(settings);
  const t = data.totals;
  renderLane(t);
  countUp($("metric-requests"), t.requests);
  $("metric-success").textContent =
    `${number(t.successful)} thành công, ${number(t.failed)} lỗi`;
  countUp($("metric-tokens"), t.input_tokens + t.output_tokens);
  $("metric-token-source").textContent =
    `${number(t.input_tokens)} vào, ${number(t.output_tokens)} ra` +
    (t.estimated_token_requests
      ? `, ${number(t.estimated_token_requests)} request ước tính`
      : "");
  countUp($("metric-estimated"), t.estimated_credits, 4);
  if (t.reported_credits === null) $("metric-reported").textContent = "—";
  else countUp($("metric-reported"), t.reported_credits, 4);
  $("metric-coverage").textContent =
    `Có ở ${number(t.reported_requests)}/${number(t.requests)} request`;
  $("latency").textContent =
    `Độ trễ trung bình ${number(t.avg_latency / 1000, 2)} giây`;
  $("updated").textContent =
    "Cập nhật " + new Date(data.generatedAt).toLocaleTimeString("vi-VN");
  countUp($("budget-used"), data.month.estimated_credits, 4);
  $("budget-limit").textContent = settings.monthlyCreditBudget
    ? number(settings.monthlyCreditBudget, 2) + " credit"
    : "Chưa đặt";
  $("budget-progress").value = settings.monthlyCreditBudget
    ? Math.min(
        100,
        (data.month.estimated_credits / settings.monthlyCreditBudget) * 100,
      )
    : 0;
  renderChart(data);
  renderAgents(data.clients ?? []);
  renderModels(data.models, t.requests);
  calculate();
  animateOverview = false;
}

function renderAgents(clients) {
  $("agent-list").innerHTML = clients.length
    ? clients
        .map((c) => {
          const a = agent(c.client);
          return `<div class="agent-row">${agentBadge(c.client)}<div><strong>${esc(a.label)}</strong><small>${number(c.tokens)} token${c.failed ? `, ${number(c.failed)} lỗi` : ""}</small></div><span class="count">${number(c.requests)}</span></div>`;
        })
        .join("")
    : empty(
        "Chưa có agent nào gọi",
        "Trỏ Claude Code, Cursor hoặc SDK tới base URL ở thanh bên.",
      );
}
function renderModels(models, total) {
  $("model-list").innerHTML = models.length
    ? models
        .map(
          (m) =>
            `<div class="model-row"><strong>${esc(m.model)}</strong><span class="count">${number(m.requests)}</span><div class="share"><i data-w="${total ? (m.requests / total) * 100 : 0}"></i></div><small>${number(m.input_tokens + m.output_tokens)} token, ${number(m.estimated_credits, 4)} credit</small></div>`,
        )
        .join("")
    : empty("Chưa có request", "Số liệu theo model xuất hiện sau lượt gọi đầu tiên.");
  // CSP forbids inline style attributes; CSSOM writes are allowed.
  for (const bar of $("model-list").querySelectorAll("[data-w]"))
    bar.style.setProperty("--w", bar.dataset.w + "%");
  replay($("model-list"), "grow");
}

function renderChart(data) {
  if (!data.totals.requests) {
    $("chart").innerHTML = empty(
      "Chưa có lưu lượng",
      "Biểu đồ xuất hiện sau request đầu tiên.",
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
  const w = 680,
    h = 200,
    left = 32,
    right = 12,
    top = 10,
    bottom = 26,
    // Round the axis up to a multiple of 4 so the five gridlines land on whole numbers.
    max = Math.max(4, Math.ceil(Math.max(...rows.map((r) => r.requests)) / 4) * 4),
    span = (w - left - right) / Math.max(1, rows.length - 1),
    x = (i) => left + i * span,
    y = (v) => h - bottom - (v * (h - top - bottom)) / max,
    barW = Math.max(3, Math.min(14, span * 0.45));
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Request và lỗi theo ngày (UTC)">`;
  for (let i = 0; i <= 4; i++) {
    const yy = y((max * i) / 4);
    svg += `<line class="c-grid" x1="${left}" y1="${yy}" x2="${w - right}" y2="${yy}"/><text x="0" y="${yy + 4}">${Math.round((max * i) / 4)}</text>`;
  }
  rows.forEach((r, i) => {
    if (r.failed)
      svg += `<rect class="c-err" x="${x(i) - barW / 2}" y="${y(r.failed)}" width="${barW}" height="${h - bottom - y(r.failed)}" rx="2" data-i="${i}"><title>${esc(r.day)}: ${r.failed} lỗi</title></rect>`;
  });
  const points = rows.map((r, i) => `${x(i)},${y(r.requests)}`).join(" ");
  svg += `<polygon class="c-area" points="${left},${h - bottom} ${points} ${x(rows.length - 1)},${h - bottom}"/>`;
  svg += `<polyline class="c-line" pathLength="1" points="${points}"/>`;
  rows.forEach((r, i) => {
    svg += `<circle class="c-dot" cx="${x(i)}" cy="${y(r.requests)}" r="3.5"><title>${esc(r.day)}: ${r.requests} request, ${r.failed} lỗi</title></circle>`;
    if (
      i === 0 ||
      i === rows.length - 1 ||
      i % Math.max(1, Math.ceil(rows.length / 7)) === 0
    )
      svg += `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${r.day.slice(8)}/${r.day.slice(5, 7)}</text>`;
  });
  $("chart").innerHTML = svg + "</svg>";
  for (const bar of $("chart").querySelectorAll("[data-i]"))
    bar.style.setProperty("--i", bar.dataset.i);
  replay($("chart"), "draw");
}

function calculate() {
  if (!settings) return;
  const input = Number($("calc-input").value),
    output = Number($("calc-output").value);
  $("calc-result").textContent =
    Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0
      ? number(
          (input * settings.inputCreditsPerMillion +
            output * settings.outputCreditsPerMillion) /
            1e6,
          6,
        )
      : "—";
  $("calc-rate").textContent =
    settings.inputCreditsPerMillion === 0 && settings.outputCreditsPerMillion === 0
      ? "Chưa đặt tỷ lệ quy đổi. Vào Cài đặt để nhập số credit cho mỗi triệu token."
      : `Tỷ lệ hiện tại: ${number(settings.inputCreditsPerMillion, 4)} credit / 1 triệu token vào, ${number(settings.outputCreditsPerMillion, 4)} / 1 triệu token ra.`;
}

function source(kind, value) {
  return value === "reported" ? "" : value === "estimated" ? `${kind} ước tính` : `${kind} chưa có`;
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
        .map((r) => {
          const notes = [source("vào", r.input_source), source("ra", r.output_source)]
            .filter(Boolean)
            .join(", ");
          const status =
            r.status === 0
              ? `<span class="status pending">Đang chạy</span>`
              : `<span class="status ${r.status >= 400 ? "error-status" : ""}">${r.status}</span>`;
          return `<tr><td><div class="who">${agentBadge(r.client, "sm")}<div><span>${esc(agent(r.client).label)}</span><small title="${esc(r.id)}">${esc(new Date(r.started).toLocaleString("vi-VN"))}</small></div></div></td><td>${esc(r.model || "—")}<small>${r.streamed ? "Stream" : "JSON"}, ${r.endpoint.includes("messages") ? "Anthropic" : "OpenAI"}</small></td><td>${status}${r.error_code ? `<small>${esc(r.error_code)}</small>` : ""}</td><td class="num">${number(r.input_tokens)} / ${number(r.output_tokens)}${notes ? `<small>${notes}</small>` : ""}</td><td class="num">${number(r.estimated_credits, 5)} / ${r.reported_credits === null ? "—" : number(r.reported_credits, 5)}</td><td class="num">${r.status === 0 ? "—" : number(r.latency / 1000, 2) + " s"}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="6">${empty("Không có request khớp bộ lọc", "Đổi khoảng thời gian hoặc bỏ bớt bộ lọc.")}</td></tr>`;
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
        `<div class="secret-row"><code>${esc(name)}</code><span class="secret-state ${present ? "" : "missing"}">${present ? "Đã có" : "Chưa có"}</span></div>`,
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
  current = ["overview", "requests", "settings"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "overview";
  const labels = {
    overview: ["Tổng quan", "Gateway có đang chạy tốt không, ai đang gọi và tốn bao nhiêu."],
    requests: ["Lịch sử request", "Từng lượt gọi: agent nào, model nào, kết quả ra sao."],
    settings: ["Cài đặt", "Model cho phép, giới hạn và cách quy đổi credit."],
  };
  for (const element of document.querySelectorAll(".page")) {
    element.hidden = element.id !== current;
    if (!element.hidden && !reduceMotion.matches) {
      element.classList.remove("page-in");
      void element.offsetWidth;
      element.classList.add("page-in");
    }
  }
  document
    .querySelectorAll("nav a")
    .forEach((a) => a.classList.toggle("active", a.dataset.page === current));
  $("page-title").textContent = labels[current][0];
  $("page-description").textContent = labels[current][1];
  document.title = `${labels[current][0]} · tg-gateway`;
  $("range-controls").hidden = current === "settings";
  if (current === "overview") animateOverview = true;
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
    $("save-status").textContent = "Đã lưu";
    toast("Đã lưu cài đặt. Tỷ lệ mới áp dụng từ request tiếp theo.");
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
    toast("Không sao chép được. Hãy chọn URL ở thanh bên rồi copy.");
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
