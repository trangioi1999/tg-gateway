# TG Gateway

Gateway TypeScript chạy trực tiếp trên **Cloudflare Workers**, có dashboard tiếng Việt để quản lý request, token và credit. Dùng Node.js 24+ cho phát triển, build và tooling; production dùng Workers runtime với `nodejs_compat`, không cần VPS.

## Tính năng đã triển khai

- OpenAI `POST /v1/chat/completions`, Anthropic `POST /v1/messages`, `GET /v1/models`.
- Text chat, system prompt, lịch sử hội thoại, function/tool calls, JSON và SSE streaming.
- Refresh token Kiro Desktop và AWS SSO/OIDC; gom các request refresh đồng thời thành một lần refresh.
- Parse AWS binary Event Stream theo frame, kiểm tra CRC, xử lý Unicode chia nhỏ qua nhiều chunk và báo lỗi khi stream bị cắt.
- Dashboard: tổng request, thành công/lỗi/đang chạy, token input/output, độ trễ, biểu đồ UTC, thống kê model, lịch sử phân trang, lọc, CSV.
- Hai cột credit độc lập: **credit quy đổi nội bộ** và **credit Kiro trả về**.
- Settings: bật/tắt gateway, model allowlist, API region, rate limit, timeout, retention, tỷ lệ token/credit, mục tiêu ngân sách tháng.
- Secrets chỉ nằm ở Cloudflare; dashboard không đọc hoặc trả giá trị bí mật. Token refresh xoay vòng được mã hóa AES-GCM trước khi lưu.
- Cookie đăng nhập HttpOnly + SameSite=Strict (+ Secure khi HTTPS), CSRF origin check, giới hạn đăng nhập, CSP, API key riêng.
- Nhận diện agent gọi tới (Claude Code, Claude Code trong IDE, Cursor, Cline, Roo Code, Kilo Code, Continue, opencode, Aider, Anthropic/OpenAI SDK, curl) từ User-Agent, hiển thị thống kê kèm logo agent và logo model (Claude, DeepSeek, Qwen, Gemini, OpenAI, OpenRouter; logo từ LobeHub icons, xem `NOTICE`). Header do client tự khai nên chỉ dùng để thống kê, không dùng cho xác thực.
- Không lưu nội dung prompt/câu trả lời. Chỉ lưu metadata request. Worker observability tắt mặc định để tránh log không cần thiết.

## Chạy local

```sh
npm ci
npm run dev:init
npm run dev
```

Mở URL mà Wrangler in ra, thường là `http://localhost:8787`.

- Mật khẩu **chỉ dùng local**: `local-dev-admin-change-me`.
- API key **chỉ dùng local**: `local-dev-api-key-change-me`.
- `.dev.vars` được tạo với quyền `0600`, bị gitignore. Không chứa credentials Kiro thật.
- Chưa cấu hình Kiro: dashboard vẫn hoạt động; gọi chat trả lỗi `credentials_missing`, được ghi vào lịch sử. Không có dữ liệu usage giả.
- Nếu cần live test local, tự thêm `KIRO_CREDENTIALS` vào `.dev.vars` bị ignore. Tuy nhiên cách được ưu tiên là đưa credentials thật thẳng lên Cloudflare như bên dưới.

## Triển khai lên tài khoản Cloudflare của bạn

1. Cài Node.js 24+, chạy `npm ci`.
2. Đổi `name` trong `wrangler.jsonc` nếu cần (phải giữ tên ổn định sau khi triển khai để giữ dữ liệu).
3. Đăng nhập và setup:

```sh
npm run login
npm run setup
```

Setup sẽ:

1. Kiểm tra tài khoản Wrangler.
2. Hỏi đường dẫn file credentials Kiro JSON có `refreshToken`.
3. Hỏi bạn đặt `ADMIN_PASSWORD` (ít nhất 16 ký tự) và `GATEWAY_API_KEY` (ít nhất 24 ký tự), nhập ẩn. Hai giá trị phải khác nhau. Lưu chúng trong password manager của bạn.
4. Deploy Worker + SQLite-backed Durable Object bằng migration đã khai báo; không cần tạo D1/KV thủ công.
5. Tạo ngẫu nhiên `SESSION_SECRET`, `VAULT_KEY` và upload tất cả bằng Wrangler Secrets qua stdin; không ghi ra file và không in giá trị.
6. In URL Workers của bạn. Mở URL đó để đăng nhập dashboard.

`setup` dành cho lần đầu. Nếu đã có `VAULT_KEY`, script dừng và giữ nguyên key để tránh làm mất khả năng giải mã token đang lưu. Nếu deploy thành công nhưng bước secrets thất bại, các endpoint nhạy cảm vẫn khóa; chạy lại setup khi đã khắc phục lỗi và chưa có VAULT_KEY.

Sau khi sửa code: `npm run check && npm test && npm run test:integration`, rồi `npm run deploy`. Deploy bình thường giữ secrets và storage của Worker.

### Các Cloudflare Secrets

| Secret | Mục đích |
| --- | --- |
| `ADMIN_PASSWORD` | Đăng nhập dashboard |
| `GATEWAY_API_KEY` | Xác thực ứng dụng gọi gateway |
| `SESSION_SECRET` | Ký session cookie |
| `VAULT_KEY` | AES-256-GCM key, 64 ký tự hex, mã hóa token xoay vòng |
| `KIRO_CREDENTIALS` | JSON credentials gốc: refreshToken, region và thông tin SSO nếu có |

Không đưa các secret này vào `vars` trong `wrangler.jsonc`, frontend, Git, URL hoặc chat. Gateway không cần giữ Cloudflare API token. Đăng nhập Wrangler là quyền triển khai của CLI trên máy bạn.

Đổi một secret bằng lệnh nhập ẩn của Wrangler:

```sh
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GATEWAY_API_KEY
```

Đổi ADMIN_PASSWORD hoặc SESSION_SECRET vô hiệu hóa các session cũ. Logout chỉ xóa cookie hiện tại; một bản sao cookie bị lộ vẫn có hiệu lực đến khi hết hạn hoặc đổi secret.

### Credentials Kiro

Đăng nhập Kiro IDE rồi dùng JSON credentials do Kiro tạo, thường ở `~/.aws/sso/cache/kiro-auth-token.json`. **Đường dẫn thực tế phụ thuộc bản Kiro và cách đăng nhập.** Với SSO, cần cả `clientId` và `clientSecret`. Script tự hợp nhất file registration cùng thư mục nếu JSON có `clientIdHash`.

Khi cần cập nhật sau khi đăng nhập lại:

```sh
npm run upload:credentials -- /absolute/path/to/kiro-auth-token.json
```

Script chỉ đọc file mà bạn chỉ định, không chỉnh sửa credentials của Kiro IDE. Nó upload JSON vào Cloudflare Secret qua stdin. Gateway nhận biết credentials gốc thay đổi bằng fingerprint và bỏ token cũ khỏi cache. Không cần reset vault thông thường.

Auth region đọc từ credentials; API region chỉnh riêng trong dashboard (mặc định `us-east-1`). Không hỗ trợ đọc SQLite của Kiro CLI trực tiếp từ cloud; phải cung cấp JSON chứa credentials tương ứng.

**Giữ VAULT_KEY ổn định.** Token refresh mới có thể thay thế token cũ của nhà cung cấp. Nếu mất/đổi VAULT_KEY, upload credentials mới sau khi đăng nhập Kiro lại rồi chọn Reset token vault trong dashboard. Đừng reset khi đang có request. Quyền truy cập Cloudflare account đồng nghĩa quyền quản lý secrets và dữ liệu gateway.

## Kết nối ứng dụng

OpenAI-compatible client:

```text
Base URL: https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/v1
API key: giá trị GATEWAY_API_KEY bạn đã đặt
Model: model ID bạn cho phép trong Settings và có trong tài khoản Kiro
```

Ví dụ shell (đặt biến môi trường trong terminal của bạn, không commit giá trị):

```sh
curl "$GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-sonnet-4.5","messages":[{"role":"user","content":"Xin chào"}],"stream":true,"stream_options":{"include_usage":true}}'
```

Anthropic-compatible client dùng base URL `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev`, endpoint `/v1/messages`, header `x-api-key` hoặc `Authorization: Bearer`. Không khai báo API key quản trị vào client.

### Claude Code (CLI và extension VS Code/JetBrains)

Thêm vào `~/.claude/settings.json` (hoặc `.claude/settings.local.json` của project, file này không nên commit):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev",
    "ANTHROPIC_API_KEY": "GATEWAY_API_KEY của bạn",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5"
  }
}
```

Extension dùng chung Claude Code CLI nên đọc cùng file này. Model ID dạng `claude-sonnet-4-5` hoặc `claude-sonnet-4-5-20250929` được chuẩn hóa thành `claude-sonnet-4.5`; model phải có trong allowlist ở Settings. Gateway nhận `thinking`/`temperature` mà Claude Code luôn gửi nhưng không chuyển tiếp (xem header `x-gateway-ignored-params`). Giới hạn: không gửi được ảnh/PDF (paste screenshot, Read file ảnh sẽ lỗi 400) và tối đa 64 tool, nên hạn chế số MCP server.

`/v1/models` trả **allowlist cấu hình**, không phải xác nhận model khả dụng từ Kiro. Kiểm tra model trong tài khoản Kiro và cập nhật Settings.

## Nhà cung cấp khác: OpenRouter, deploy.com

Ngoài Kiro, gateway gọi được nhà cung cấp tương thích OpenAI. Chọn bằng tiền tố model ID trong **Settings → Model cho phép**:

| Tiền tố | Nhà cung cấp | Secret | Ví dụ |
| --- | --- | --- | --- |
| *(không có)* | Kiro | `KIRO_CREDENTIALS` | `claude-sonnet-4.5` |
| `openrouter/` | OpenRouter | `OPENROUTER_API_KEY` | `openrouter/deepseek/deepseek-chat-v3.1` |
| `deploy/` | deploy.com | `DEPLOY_API_KEY` | `deploy/deepseek-ai/deepseek-v4.1-flash-1017` |

```sh
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put DEPLOY_API_KEY
```

- Gateway bỏ tiền tố trước khi gọi upstream. Client gọi đúng ID có tiền tố, ví dụ Claude Code: `ANTHROPIC_MODEL=openrouter/deepseek/deepseek-chat-v3.1`.
- Client Anthropic (Claude Code) được chuyển đổi sang chat completions: system, text, ảnh, tool call/tool result, `tool_choice`, `max_tokens`, `stop_sequences`, `temperature/top_p/top_k`. `thinking` thành `reasoning` (OpenRouter) hoặc `reasoning_effort: none` khi tắt (deploy.com). Nội dung reasoning trả về không được chuyển thành block thinking. Text stream liên tục; tool call được gom đủ rồi gửi một lần.
- Client OpenAI được chuyển tiếp nguyên trường, chỉ thay model.
- Token lấy từ `usage` của nhà cung cấp (ghi là *reported*); OpenRouter trả thêm chi phí USD, lưu ở cột `cost_usd` và hiện cạnh credit trong lịch sử.
- Không qua Kiro nên không cần credentials Kiro và không có credit Kiro. Tool calling phụ thuộc model/nhà cung cấp: tài liệu deploy.com hiện không nói tới tool calling, nên Claude Code có thể không dùng được tool với model đó.

## Token và credit: ý nghĩa số liệu

1. Nếu event upstream trả `inputTokens`/`outputTokens`, gateway ghi nhận token là **reported**.
2. Nếu không, input ước tính từ byte UTF-8 của payload / 4; output từ byte UTF-8 của text và tool calls / 4, làm tròn lên. Đây là heuristic, không phải tokenizer chính thức của Claude. Context usage percentage được lưu riêng, không biến thành token chính xác.
3. Credit quy đổi = `(input × inputCreditsPerMillion + output × outputCreditsPerMillion) / 1.000.000`.
4. Tỷ lệ mặc định bằng 0 vì chưa biết quy ước của bạn. Tự nhập trong Settings. Mỗi request lưu snapshot tỷ lệ; thay đổi sau này không viết lại lịch sử.
5. Credit Kiro là giá trị số `usage` trong `meteringEvent`. Thiếu event thì lưu `null`, UI hiển thị `—`; giá trị 0 thật vẫn hiển thị 0. Dashboard cho biết có số liệu ở bao nhiêu request.
6. **Credit Kiro không phải số dư, hóa đơn hoặc quota tài khoản.** Gateway chỉ biết request đi qua nó; request trực tiếp từ IDE/CLI không xuất hiện ở đây. Cần đối chiếu portal Kiro nếu cần số dư hoặc hóa đơn.
7. Stream kết thúc sạch nhưng thiếu `meteringEvent`/context event vẫn tính là thành công (200), kèm mã `no_completion_signal` trong lịch sử để dễ phát hiện khi giao thức Kiro thay đổi. Tool call bị cắt giữa chừng vẫn là lỗi. Stream lỗi/ngắt có thể chỉ ghi được phần token đã nhận. Không trả HTTP 200 thành công trong nhật ký nếu nhận lỗi sau khi bắt đầu SSE; HTTP headers thực tế của SSE đã gửi vẫn là 200, lỗi được trả qua event.
8. `monthlyCreditBudget` chỉ là mục tiêu theo dõi, **không chặn cứng chi phí**. Báo cáo tháng dựa trên UTC và dữ liệu còn lưu. Retention thấp hơn một tháng sẽ khiến báo cáo tháng thiếu lịch sử.

Request chưa qua xác thực không vào usage ledger. Request gọi chat đã qua xác thực được ghi lại kể cả validation error, rate limit và lỗi credentials. Rate limit là tổng số chat request/phút cho gateway một tài khoản; `/v1/models` không tính vào ledger.

## Kiến trúc

```text
Ứng dụng ── API key ──> Worker ──> Gateway Durable Object ──> Kiro runtime
Dashboard ── cookie ──> Worker ──>         │
                                         ├─ SQLite: settings, request metadata, rate limits
                                         └─ KV storage: AES-GCM encrypted rotated tokens
Cloudflare Secrets ───────────────────────┘
```

Một Durable Object có tên ổn định `primary` điều phối một tài khoản Kiro: refresh token không tranh chấp giữa nhiều isolate và rate limit/ledger nhất quán. Object có thể phục vụ nhiều request bất đồng bộ, nhưng đây là kiến trúc cho cá nhân/nhóm nhỏ, không phải hệ thống nhiều tenant. Static assets được Worker phục vụ; `/api/*` yêu cầu session, `/v1/*` yêu cầu API key. Alarm dọn lịch sử mỗi giờ và đánh dấu request bị gián đoạn quá 15 phút là `598 interrupted_unknown` (usage không thể khôi phục).

Các file chính: `src/index.ts` (API + SQL ledger), `src/protocol.ts` (chuyển đổi + binary parser), `src/kiro-auth.ts` (refresh + vault), `src/stream.ts` (SSE/JSON), `src/security.ts` (session/crypto), `public/` (dashboard).

## Kiểm thử

```sh
npm run check
npm test
npm run test:integration
```

Unit tests kiểm tra chuyển đổi, tool pairing, CRC/UTF-8, stream bị cắt, token/credit, SSO refresh, single-flight refresh, mã hóa vault, session và CSRF. Integration test chạy Worker + SQLite thật trên Miniflare với **upstream giả lập**, kiểm tra auth, stream OpenAI/Anthropic, request dạng Claude Code (thinking, cache_control, tool round-trip), tỷ lệ lịch sử không đổi, lỗi và CSV. Test không gọi Kiro thật và không tốn credit. GitHub Actions chạy cả ba bước trên mỗi push và pull request.

## Phạm vi phiên bản này

- Chưa test end-to-end với tài khoản Kiro thật nếu chưa cung cấp credentials. Giao thức Kiro có thể thay đổi; cần smoke-test sau khi triển khai.
- Một tài khoản Kiro, một admin, một API key. Chưa có multi-account failover hay người dùng riêng.
- Hỗ trợ text và function tools. Chưa hỗ trợ ảnh, web search tích hợp, Responses API, embeddings hay extended thinking.
- `thinking`, `temperature`, `top_p`, `top_k` được chấp nhận nhưng **bỏ qua** (liệt kê trong header `x-gateway-ignored-params`). Các tham số làm thay đổi nội dung kết quả như `stop`, `stop_sequences`, `response_format`, `seed` vẫn bị từ chối rõ ràng. `max_tokens`/`max_completion_tokens` chỉ là compatibility hint, **không áp đặt giới hạn output** vì chưa xác minh trường tương đương trong giao thức Kiro. Không dùng chúng để khống chế chi phí.
- Tool arguments được gom đầy đủ trước khi gửi tool block; text vẫn stream từng phần. Client tự thực thi tool.
- Giới hạn JSON đầu vào 1 MiB, dữ liệu stream tổng 16 MiB, timeout tối đa 600 giây, export CSV tối đa 5.000 dòng. Không tự retry 429/5xx để tránh ghi nhận/gọi model trùng; chỉ refresh và thử lại một lần khi upstream trả 401/403.
- Dashboard không tạo/sửa secret trên Cloudflare vì như vậy phải trao quyền Cloudflare API cho chính ứng dụng. Dùng script/CLI hoặc Cloudflare Dashboard.

Tham khảo giao thức: [jwadow/kiro-gateway](https://github.com/jwadow/kiro-gateway). License AGPL-3.0-or-later; xem `NOTICE` và `LICENSE`.
