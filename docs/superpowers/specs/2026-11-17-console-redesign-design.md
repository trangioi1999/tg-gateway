# Thiết kế: Console TG Gateway mới (React, thống kê, chi tiết request, credit thật)

Ngày: 2026-11-17 · Mockup đã chốt: `docs/mockups/console-redesign.html`

## Mục đích

Dashboard hiện tại (`public/*.js`, JavaScript thuần) khó mở rộng. Người dùng cần:

- xem số liệu theo **ngày / tuần / tháng** và theo **nhà cung cấp** (Kiro, Claude API, OpenRouter);
- **xóa log mà không mất số tổng**;
- bấm một request để xem **nguồn gọi, các bước xử lý, payload, response, lỗi**;
- thấy **credit thật** của Kiro (ví dụ 235 / 2.000), chi phí Claude API, số dư OpenRouter;
- giao diện style Apple (sáng/tối) như mockup; code sạch, cấu trúc rõ.

Người dùng duy nhất là quản trị viên của gateway (tự host trên Cloudflare Workers).

## Mục tiêu / Không làm / Thất bại nếu

- **Mục tiêu:** dựng lại đủ 4 màn trong mockup (Đăng nhập, Tổng quan, Lịch sử + dialog chi
  tiết, Cài đặt chia tab) bằng React; thêm các API backend tương ứng; giữ nguyên hành vi
  proxy `/v1/*`.
- **Không làm:** đổi database (giữ SQLite trong Durable Object, không Firebase); biểu đồ
  lưu lượng (đã bỏ khỏi mockup); cảnh báo ngân sách qua email/notification; đa người dùng.
- **Thất bại nếu:** request `/v1/*` chậm đi hoặc đổi hành vi; xóa log làm mất số tổng;
  payload (dữ liệu riêng tư) bị lưu khi người dùng chưa bật; CSP hiện tại phải nới lỏng.

## Ràng buộc

- Cloudflare Workers + 1 Durable Object `Gateway` (SQLite). Static assets qua binding `ASSETS`.
- CSP hiện tại: `script-src 'self'; style-src 'self'; font-src` mặc định `'self'` → không
  dùng Google Fonts, không inline script/style. Font **Be Vietnam Pro** tự host (gói
  `@fontsource/be-vietnam-pro`, có subset tiếng Việt).
- Test hiện có: `npm run check`, `npm test` (node:test), `npm run test:integration`
  (Miniflare chạy `dist/index.js`). Tất cả phải tiếp tục xanh; CI chạy cả 3.
- Giao diện tiếng Việt (như hiện tại).

## Các hướng đã cân nhắc

| Hướng | Ưu | Nhược |
|---|---|---|
| **A. Vite + React + TS trong `web/`, build ra `web/dist` làm assets** (chọn) | Chuẩn, build nhanh, CSP-safe (file JS/CSS riêng), type-check chung TS | Thêm bước build trước deploy |
| B. Giữ JS thuần, viết thêm | Không build | Dialog/tab/state phức tạp → khó bảo trì; người dùng yêu cầu React |
| C. Next.js / Remix trên Workers | SSR | Quá nặng cho console 1 người dùng, đổi cả cách deploy |

Chọn **A** (người dùng yêu cầu React; B và C không hợp).

Thống kê:

| Hướng | Chọn? |
|---|---|
| **Bảng `stats_hourly` cộng dồn theo giờ + provider + client + model** | ✔ Gộp theo múi giờ người xem phía server (offset phút), xóa log không ảnh hưởng |
| Tính lại từ bảng `requests` | ✘ chính là lỗi hiện tại: xóa log/hết hạn lưu làm mất số |
| Firebase / D1 riêng | ✘ thêm độ trễ, thêm dịch vụ, không giải quyết gì SQLite chưa làm được |

## Cấu trúc thư mục mới

```
src/                      Worker (TypeScript, giữ đường dẫn để test import không đổi)
  index.ts                entry Worker: định tuyến tới DO / assets, security headers
  gateway.ts              class Gateway (DO): khởi tạo, fetch() định tuyến, chat()
  db/schema.ts            tạo bảng + migration cột (PRAGMA user_version)
  db/stats.ts             upsert thống kê, backfill, truy vấn theo kỳ
  dashboard/api.ts        handler /api/* (overview, requests, detail, export, providers)
  dashboard/period.ts     tính khoảng thời gian ngày/tuần/tháng + kỳ trước (thuần, có test)
  upstream/kiro.ts        gọi generateAssistantResponse + kiroError (tách khỏi index.ts)
  upstream/quota.ts       credit Kiro (getUsageLimits), số dư OpenRouter, cache 5 phút
  trace.ts                ghi các bước xử lý + capture payload có giới hạn (thuần, có test)
  (giữ nguyên) protocol.ts stream.ts compat.ts context.ts cache.ts kiro-auth.ts security.ts clients.ts types.ts
web/                      Frontend React
  index.html, vite.config.ts, tsconfig.json
  public/                 icon.svg, brands/*.svg (chuyển từ public/)
  src/main.tsx, App.tsx   router nhỏ (history API: /login, /overview, /requests, /settings)
  src/api/                client fetch + kiểu dữ liệu API
  src/lib/                format số/thời gian, brand map, highlight JSON/SSE (thuần, có test)
  src/components/         Sidebar, Seg (segmented), Card, Stepper, CodeBox, Dialog, Switch, ...
  src/pages/              Login, Overview, Requests (+ RequestDialog), Settings (+ panels)
  src/styles/             tokens.css (sáng/tối như mockup), base.css, components.css
public/                   XÓA sau khi chuyển xong (assets dời sang web/)
```

`wrangler.jsonc`: `assets.directory` → `./web/dist`. `package.json`:
`build:web` = `vite build web`, `build` = `npm run build:web && wrangler deploy --dry-run --outdir dist`,
`deploy` = `npm run build:web && wrangler deploy`, `dev:web` = Vite dev server proxy `/api` tới
`wrangler dev`. `check` type-check cả `src`, `tests`, `web`.

## Backend

### 1. Thống kê bền vững

Bảng mới:

```sql
stats_hourly(hour INTEGER, provider TEXT, client TEXT, model TEXT,
  requests, successful, failed, input_tokens, output_tokens,
  estimated_credits REAL, reported_credits REAL, reported_requests, cost_usd REAL,
  saved_tokens, cache_hits, latency_sum, latency_count,
  PRIMARY KEY(hour, provider, client, model))
```

- `hour` = `floor(started / 3600000)`. Upsert một lần khi request kết thúc (`finish()` trong
  `chat()` và `summarize()`), cùng transaction với UPDATE `requests`.
- Migration một lần (theo `PRAGMA user_version`): backfill từ các dòng `requests` đã xong.
- `DELETE /api/requests` và dọn dẹp theo `retentionDays` **không** đụng `stats_hourly`.
  Bảng này không hết hạn.
- Request đang chạy (status 0) không nằm trong thống kê; số "đang chạy" đọc từ `requests`.

### 2. API tổng quan theo kỳ

`GET /api/overview?period=day|week|month&anchor=YYYY-MM-DD&tz=<phút lệch UTC>&provider=all|kiro|anthropic|openrouter|deploy`

- `dashboard/period.ts` tính `[from, to)` theo giờ địa phương của người xem (tuần bắt đầu thứ
  Hai), và kỳ trước cùng độ dài để so sánh.
- Trả: `range`, `totals`, `previous` (totals kỳ trước), `byProvider`, `models`, `clients`,
  `month` (đầu tháng đến nay, cho thẻ ngân sách), `active` (đang chạy), `settings`.
- Giữ tham số cũ `days=` cho tương thích? Không cần (chỉ dashboard dùng); bỏ.

### 3. Chi tiết request

Thêm cột vào `requests`: `ip`, `country`, `city`, `colo`, `user_agent`, `error_message`,
`upstream_host`, `ttfb` (ms), `steps` (JSON).

- Nguồn: `CF-Connecting-IP`, `request.cf.country/city/colo`, `User-Agent` (cắt 300 ký tự).
- `trace.ts` — `Trace` ghi các bước `{ key, label, at (ms từ lúc nhận), dur, state, detail }`:
  nhận request, xác thực/giới hạn, tiết kiệm credit (clear/compact, hoặc bỏ qua + lý do),
  cache/local reply, gửi upstream (host), byte đầu tiên, stream xong, hoàn tất / lỗi.
  Lưu vào `steps` khi `finish()`.
- Payload (tùy chọn) — bảng `payloads(id PRIMARY KEY, created, request TEXT, response TEXT, truncated INTEGER)`:
  - Setting mới `capturePayloads: "off" | "errors" | "all"` (mặc định `"off"`) và
    `payloadRetentionDays` (1–30, mặc định 3).
  - Request: body JSON client gửi (trước khi gateway sửa). Response: text gateway đã gửi về
    client (SSE hoặc JSON). Mỗi phần cắt ở 64 KB, đánh dấu `truncated`.
  - Chế độ `errors`: giữ trong bộ nhớ trong lúc chạy, chỉ ghi khi request lỗi.
  - Tắt capture → xóa toàn bộ bảng `payloads`. Alarm hằng giờ xóa payload quá hạn.
    `DELETE /api/requests` xóa cả payload tương ứng.
- `GET /api/requests/:id` → `{ request: row, steps, payload: { request, response, truncated } | null }`.
- `GET /api/requests` thêm lọc `provider`, tìm `q` (agent/model/IP/mã lỗi), khoảng
  `period/anchor/tz` như overview (thay `days`).

### 4. Credit thật theo nhà cung cấp

`GET /api/providers` (cache trong bộ nhớ DO 5 phút; `?refresh=1` bỏ cache):

- **Kiro:** `GET https://q.<apiRegion>.amazonaws.com/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST&profileArn=…`
  với access token hiện có. Parse phòng thủ: tìm mục credit trong `usageBreakdownList`
  (`currentUsage(WithPrecision)`, `usageLimit(WithPrecision)`), `nextDateReset`,
  `subscriptionInfo.subscriptionTitle`. Lỗi/không parse được → `{ ok: false, error }`, UI
  hiện "Không lấy được credit Kiro" và vẫn hiện credit Kiro báo cáo cộng dồn từ thống kê.
- **Claude API:** không có API số dư → chi phí tháng này từ `stats_hourly.cost_usd`
  (provider `anthropic`) + setting mới `anthropicMonthlyBudgetUsd` (0 = không đặt).
- **OpenRouter:** `GET https://openrouter.ai/api/v1/credits` (Bearer key) →
  `total_credits - total_usage`.
- **deploy.com:** chỉ chi phí/request từ thống kê (không có API số dư).
- Provider chỉ hiện khi đã đặt key (Kiro: có credentials) hoặc có lưu lượng trong kỳ.

### 5. Setting mới

`displayName` (tên trong lời chào, mặc định "Admin"), `capturePayloads`,
`payloadRetentionDays`, `anthropicMonthlyBudgetUsd`. Thêm vào `defaults` + `validateSettings`.

### 6. Dọn code

- Tách `index.ts` (1.220 dòng) theo cấu trúc trên; không đổi logic proxy.
- `chat()` giữ trong `gateway.ts`, chỉ thêm gọi `Trace`/capture/stats.

## Frontend (theo mockup)

- **Chung:** style Apple, font Be Vietnam Pro (tiêu đề 700, nhãn 600), token màu sáng/tối
  như mockup, theme Sáng/Tối/Tự động lưu `localStorage`. Logo TG hiện có; logo agent/nhà
  cung cấp từ `brands/` (đen-trắng dùng `currentColor` qua mask CSS).
- **Đăng nhập:** chia đôi. Trái: logo, "Chào mừng đến TG Gateway" (không xuống dòng giữa
  TG/Gateway), ô mật khẩu có nút hiện/ẩn, lỗi đỏ dưới ô, nút Tiếp tục, footer
  "© <năm> TG Gateway · By Trần Giỏi". Phải: sơ đồ luồng SVG kiểu n8n (agent → Gateway →
  Tiết kiệm → Định tuyến → nhà cung cấp, nhánh Thống kê), chấm request đi / response về
  chạy trên mọi dây, tắt khi `prefers-reduced-motion`. Ẩn panel phải khi màn hẹp.
- **Sidebar:** logo + "TG Gateway", Workspace (Tổng quan, Lịch sử request, Cài đặt), Nhà cung
  cấp (logo + số nhanh), Đăng xuất. Không có ô trạng thái.
- **Tổng quan:** "Xin chào, {displayName}"; thanh Ngày/Tuần/Tháng + ‹ kỳ › + "So với kỳ
  trước"; tab nhà cung cấp (đang chọn = nền xanh nhạt, viền xanh); thẻ quota của tab đang
  chọn + 4 KPI (request, token, tỷ lệ thành công, độ trễ TB, có % so kỳ trước); hàng Ngân
  sách tháng (gauge) · Tiết kiệm credit (ring) · Model đang dùng; bảng 5 request gần nhất.
  Không có biểu đồ lưu lượng.
- **Lịch sử:** 4 số tổng; lọc (tìm kiếm, trạng thái, nhà cung cấp, kỳ); bảng cột Thời gian |
  Agent | Nguồn | Model | Trạng thái | Input/Output | Quy đổi/Kiro | Tiết kiệm | Độ trễ;
  phân trang; Xuất CSV; Xóa log (dialog xác nhận nói rõ số tổng được giữ; chọn "cũ hơn 7
  ngày" hoặc "toàn bộ" — backend nhận `?before=`).
- **Dialog chi tiết:** tiêu đề "Agent → model", trạng thái, giờ, độ trễ; tab Tổng quan (lưới
  thông tin + bảng "Các bước xử lý": Thời điểm hh:mm:ss | icon | Bước | Thời lượng + thanh
  waterfall), Request / Response (CodeBox: JSON/SSE tô màu kiểu Xcode, số dòng, nút Xuống
  dòng, nút Sao chép), Lỗi (hộp lỗi + cách xử lý + JSON lỗi). Payload không có → hướng dẫn
  bật trong Cài đặt → Dữ liệu & log.
- **Cài đặt:** menu trái 8 mục (Chung, Kiro, Claude API, OpenRouter, Tiết kiệm credit, Ngân
  sách, Kết nối & bảo mật, Dữ liệu & log), danh sách nhóm kiểu iOS, công tắc; thanh "Lưu cài
  đặt" dính đáy hiện số thay đổi chưa lưu.

## Kiểm thử

- Unit (node:test): `period.ts`, `stats` upsert/backfill (qua SQL trong Miniflare hoặc hàm
  thuần sinh câu lệnh), `trace.ts` (bước + cắt 64 KB), parse `getUsageLimits` và
  OpenRouter credits, `web/src/lib` (format, highlight).
- Integration (Miniflare): thống kê còn sau `DELETE /api/requests`; overview theo kỳ;
  `/api/requests/:id` có steps; capture `errors` chỉ lưu khi lỗi; `/api/providers` với
  upstream giả (getUsageLimits + OpenRouter credits); assets React được phục vụ ở `/` và
  `/overview`.
- Kiểm tra thủ công: chạy `wrangler dev`, chụp màn hình 4 màn sáng/tối bằng trình duyệt.

## Để builder tự quyết

Tên component/hook, chia file CSS, cách cache dữ liệu phía client (fetch + state đơn giản,
không thêm thư viện state), chi tiết animation sơ đồ luồng.

## Quyết định do Claude đưa ra (người dùng có thể đổi)

- Thống kê theo giờ để hiển thị đúng múi giờ người xem (Việt Nam UTC+7).
- Payload mặc định **tắt**; chế độ `errors` là lựa chọn gợi ý.
- Bỏ "Cảnh báo khi đạt %" trong mockup (chưa có kênh thông báo).
- Bỏ "Còn N lần thử" ở màn đăng nhập (backend không trả số lần còn lại).
- Lời chào dùng setting `displayName`.
- Không gọi được Codex trong phiên này → chia việc cho các agent phụ của Claude.
