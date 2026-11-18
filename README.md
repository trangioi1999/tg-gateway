# TG Gateway

Gateway TypeScript chạy trực tiếp trên **Cloudflare Workers**, có dashboard tiếng Việt để quản lý request, token và credit. Dùng Node.js 24+ cho phát triển, build và tooling; production dùng Workers runtime với `nodejs_compat`, không cần VPS.

## Tính năng đã triển khai

- OpenAI `POST /v1/chat/completions`, Anthropic `POST /v1/messages`, `GET /v1/models`.
- Text chat, system prompt, lịch sử hội thoại, function/tool calls, JSON và SSE streaming.
- Refresh token Kiro Desktop và AWS SSO/OIDC; gom các request refresh đồng thời thành một lần refresh.
- Parse AWS binary Event Stream theo frame, kiểm tra CRC, xử lý Unicode chia nhỏ qua nhiều chunk và báo lỗi khi stream bị cắt.
- Console web (React + TypeScript + Vite, trong `web/`) gồm các màn hình:
  - **Đăng nhập**.
  - **Tổng quan**: tổng request, thành công/lỗi/đang chạy, token input/output, độ trễ, thống kê model; xem theo ngày/tuần/tháng và theo nhà cung cấp.
  - **Lịch sử request**: phân trang, lọc, CSV, cột nhà cung cấp; bấm một dòng để mở dialog chi tiết gồm nguồn gọi, các bước xử lý, payload/response (nếu đã bật capture) và lỗi. Payload/response hiển thị đã định dạng sẵn (JSON thụt lề kể cả khi bị cắt ở 64 KB, stream SSE được ghép lại thành message cuối); nút "Gốc" xem bytes nguyên bản.
  - **Tổng quan theo ngày**: Tổng quan và Lịch sử mở mặc định ở tab **Ngày**; dùng ‹ › để xem các ngày trước. Thẻ **Credit Kiro** là tổng credit Kiro báo cáo trong kỳ (kèm trung bình mỗi request), thẻ **Token** ghi rõ token vào/ra. Lọc theo nhà cung cấp khác Kiro thì thẻ này hiện chi phí USD.
  - **Phiên và context**: dialog chi tiết hiện **Phiên Claude Code** (lấy từ header `x-claude-code-session-id` hoặc `metadata.user_id`; trùng tên file lịch sử `~/.claude/projects/<dự án>/<session>.jsonl`) và **Kiro conversationId** gateway đã gửi, nút "Xem cùng ID" lọc Lịch sử theo ID đó. Với đường Kiro còn có khối **Context gửi lên Kiro**: số token ước tính của system prompt, định nghĩa tool, tin nhắn cũ, kết quả tool cũ, tham số tool cũ, lượt hiện tại và phần gateway đã cắt (chỉ lưu con số).
  - **Thử nghiệm: giữ conversationId theo phiên** (Cài đặt → Tiết kiệm credit, mặc định tắt): mỗi mạch hội thoại (phiên chính, từng subagent) dùng một conversationId Kiro cố định, tính từ phiên Claude Code và lượt đầu tiên. Dùng để đo xem Kiro có tính credit khác không; Claude Code vẫn gửi đủ lịch sử, ngữ cảnh không đổi.
  - **Agent gọi request**: dưới tên client trong bảng Lịch sử (và trong dialog) hiện agent đã gửi request: "Phiên chính", "Nền" (request phụ không kèm tool của Claude Code, ví dụ đặt tiêu đề phiên), "Subagent", "Phân loại auto mode" (bộ phân loại an toàn của auto mode), đoán từ system prompt của Claude Code. Để thấy tên riêng như `coder`, `leader`, thêm một dòng `[agent:coder]` vào phần nội dung (dưới frontmatter) của file agent, ví dụ `.claude/agents/coder.md`. Ô tìm kiếm cũng tìm theo tên agent.
  - **Request đang chạy**: dialog tự cập nhật mỗi giây, hiện bước đang chạy và **output trực tiếp** (text, thinking, tool call) như log của một pipeline CI. Output này chỉ nằm trong bộ nhớ khi request còn chạy, không lưu vào DB. Nút **Dừng** (trong dialog hoặc ■ trên dòng của bảng) cắt request: client nhận lỗi `cancelled` kèm `x-should-retry: false`, log ghi 499 `cancelled`.
  - **Phiên bản web**: góc dưới sidebar hiện `v<version>` (ví dụ `v0.1.0`, lấy từ `package.json`); rê chuột vào để xem commit và giờ build. Khi bản deploy mới hơn tab đang mở (kiểm tra `/version.json` mỗi 5 phút và khi quay lại tab), sidebar hiện "Có bản mới · Tải lại". Dùng để biết chắc Worker đã được deploy bản mới chưa.
  - **Cài đặt** (8 mục).
- Thống kê theo giờ được giữ vĩnh viễn: xóa log/lịch sử request không làm mất số tổng.
- Credit thật của nhà cung cấp (cache 5 phút): Kiro (`getUsageLimits`), OpenRouter (số dư), Claude API (chi phí tháng tính từ usage).
- Hai cột credit độc lập: **credit quy đổi nội bộ** và **credit Kiro trả về**.
- Settings: bật/tắt gateway, model allowlist, API region, rate limit, timeout, retention, tỷ lệ token/credit, mục tiêu ngân sách tháng.
- Tiết kiệm credit Kiro: xóa tool result cũ, compact hội thoại dài, cache request trùng, trả lời tại chỗ request `max_tokens: 1`, timeout theo thời gian im lặng (xem [Tiết kiệm credit Kiro](#tiết-kiệm-credit-kiro)).
- Secrets chỉ nằm ở Cloudflare; dashboard không đọc hoặc trả giá trị bí mật. Token refresh xoay vòng được mã hóa AES-GCM trước khi lưu.
- Cookie đăng nhập HttpOnly + SameSite=Strict (+ Secure khi HTTPS), CSRF origin check, giới hạn đăng nhập, CSP, API key riêng.
- Nhận diện agent gọi tới (Claude Code, Claude Code trong IDE, Cursor, Cline, Roo Code, Kilo Code, Continue, opencode, Aider, Anthropic/OpenAI SDK, curl) từ User-Agent, hiển thị thống kê kèm logo agent và logo model (Claude, DeepSeek, Qwen, Gemini, OpenAI, OpenRouter; logo từ LobeHub icons, xem `NOTICE`). Header do client tự khai nên chỉ dùng để thống kê, không dùng cho xác thực.
- Mặc định không lưu nội dung prompt/câu trả lời, chỉ lưu metadata request (ngoại lệ: bản tóm tắt khi bật Compact, xem bên dưới; và payload capture khi bạn chủ động bật, xem [Payload capture](#payload-capture)). Worker observability tắt mặc định để tránh log không cần thiết.

## Chạy local

```sh
npm ci
npm run dev:init
npm run dev
```

Mở URL mà Wrangler in ra, thường là `http://localhost:8787`. `npm run dev` build console một lần vào `web/dist` (thư mục `assets.directory` của Wrangler, không commit vào git) rồi chạy `wrangler dev` (cổng 8787). Console không tự build lại khi bạn sửa code trong `web/`.

Khi sửa giao diện, chạy thêm `npm run dev:web` ở terminal khác: Vite chạy ở `http://localhost:5173` với hot reload và proxy `/api`, `/v1`, `/health` sang `:8787`.

Build/deploy: `npm run build` (build web rồi `wrangler deploy --dry-run`), `npm run deploy` (build web rồi deploy).

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

**Cách dễ nhất: dashboard → Cài đặt → Đăng nhập Kiro.** Chọn file `kiro-auth-token.json` (Windows: `%USERPROFILE%\.aws\sso\cache\`; Builder ID/SSO thì chọn thêm file `<clientIdHash>.json` cùng thư mục) hoặc dán JSON, bấm *Lưu & kiểm tra*. Gateway refresh thử ngay; token hỏng thì không lưu. Token được mã hóa bằng `VAULT_KEY` trong Durable Object, không cần secret `KIRO_CREDENTIALS`. Nếu sau đó bạn đặt/đổi `KIRO_CREDENTIALS`, secret mới sẽ được ưu tiên.

Hoặc dùng Cloudflare Secret, khi cần cập nhật sau khi đăng nhập lại:

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

### Claude Code (CLI và extension VS Code/JetBrains) trên máy bất kỳ

**Điều kiện:** gateway đã đủ secret. Kiểm tra bằng `npx wrangler secret list` (cần có `ADMIN_PASSWORD`, `GATEWAY_API_KEY`, `SESSION_SECRET`, `VAULT_KEY`, cộng key của các đường bạn dùng: `KIRO_CREDENTIALS` (hoặc nhập Kiro trong dashboard), `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `DEPLOY_API_KEY`). Nếu API trả `setup_required` là còn thiếu. Bổ sung từng secret còn thiếu mà không đụng secret đã có:

```sh
npx wrangler secret put GATEWAY_API_KEY                  # nhập ẩn, ≥ 24 ký tự
openssl rand -hex 32 | npx wrangler secret put VAULT_KEY  # chỉ khi CHƯA có VAULT_KEY
# Kiro: nhập trong dashboard → Cài đặt → Đăng nhập Kiro (hoặc npm run upload:credentials -- <file>)
```

Trên máy dùng Claude Code, sửa `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`). Extension VS Code/JetBrains đọc chung file này:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev",
    "ANTHROPIC_AUTH_TOKEN": "GATEWAY_API_KEY của bạn",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5"
  }
}
```

- `ANTHROPIC_AUTH_TOKEN` gửi `Authorization: Bearer`; gateway nhận cả cách này lẫn `ANTHROPIC_API_KEY` (`x-api-key`), nhưng Claude Code interactive có thể hỏi xác nhận khi thấy `ANTHROPIC_API_KEY`.
- Khi đặt token, Claude Code dùng gateway thay cho đăng nhập claude.ai; connector của claude.ai sẽ tắt.
- Nếu bật Cloudflare Access cho domain, thêm `"ANTHROPIC_CUSTOM_HEADERS": "CF-Access-Client-Id: <id>\nCF-Access-Client-Secret: <secret>"` (service token của Access).
- Model trong `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` phải có trong allowlist ở Settings. Đổi đường đi theo phiên: `claude --model anthropic/claude-opus-5-5` hoặc `/model ...` (xem bảng tiền tố bên dưới).

Kiểm tra:

```sh
curl -s https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/v1/models -H "Authorization: Bearer $GATEWAY_API_KEY"
claude -p "chào"
```

Sau đó mở dashboard → Lịch sử request: dòng mới có icon Claude Code và tên đường đi (Kiro/Anthropic/OpenRouter/deploy.com).

Model ID dạng `claude-sonnet-4-5` hoặc `claude-sonnet-4-5-20250929` được chuẩn hóa thành `claude-sonnet-4.5` khi đi Kiro. Đường Kiro nhận `thinking`/`temperature` mà Claude Code luôn gửi nhưng không chuyển tiếp (header `x-gateway-ignored-params`); không gửi được ảnh/PDF (ảnh trong tool result được thay bằng một dòng ghi chú) và tối đa 256 tool. Tool call không ghép cặp được (request compact của Claude Code không kèm `tools`, MCP server bị ngắt, tool call bị ngắt giữa chừng, trùng ID) được gửi dưới dạng text thay vì báo lỗi 400; tên tool Kiro không nhận được tự đổi tên rồi đổi lại khi trả về. Đường `anthropic/` không có các giới hạn này vì request được chuyển tiếp nguyên văn.

## Tiết kiệm credit Kiro

Mỗi lượt Claude Code gửi lại toàn bộ hội thoại, gồm system prompt, danh sách tool và mọi tool
result. Kiro không có prompt caching nên phần lặp lại bị tính tiền ở mọi lượt. Các cơ chế dưới
đây chỉ áp dụng cho đường Kiro, chỉnh trong **Cài đặt → Tiết kiệm credit**. Lịch sử request
ghi rõ cơ chế nào đã chạy và số token tiết kiệm (ước tính); trang Tổng quan cộng tổng.

| Cơ chế | Mặc định | Hoạt động |
| --- | --- | --- |
| Timeout khi im lặng | 180 s | Chỉ cắt khi upstream không gửi byte nào trong N giây, trần 30 phút. Trước đây timeout tính trên tổng thời gian, nên câu trả lời dài bị cắt, client gửi lại và Kiro tính tiền lại. |
| Không retry sau khi đã tính tiền | luôn bật | Kiro đã trả lời mà gateway vẫn lỗi (ví dụ tham số tool hỏng): gắn `x-should-retry: false` để SDK Anthropic/OpenAI không gửi lại. |
| Trả lời tại chỗ `max_tokens: 1` | luôn bật | Request dò quota của Claude Code không tới Kiro (Kiro bỏ qua `max_tokens`, nên sẽ trả lời đầy đủ). |
| Xóa tool result cũ | bật, ngưỡng 60k token, giữ 4 | Khi prompt vượt ngưỡng, output của các lần gọi tool cũ được thay bằng một dòng ghi chú. Cặp gọi/kết quả tool và tin nhắn hiện tại giữ nguyên. Tùy chọn rút gọn cả tham số tool cũ. Lịch sử phía client không đổi. |
| Compact | **tắt** | Khi prompt vẫn vượt 120k token, tóm tắt phần đầu bằng `compactModel` (mặc định `claude-haiku-4.5`), giữ nguyên ~30k token cuối. Bản tóm tắt được dùng lại cho các lượt sau, chỉ tóm tắt thêm khi cần. Mỗi lần tóm tắt hiện thành một dòng `internal:compact` trong lịch sử. |
| Cache câu trả lời | 300 s | Request giống hệt từng byte được phát lại từ bộ nhớ (header `x-gateway-cache: hit`, 0 credit). Request giống hệt đang chạy song song chỉ gọi Kiro một lần. |
| Model cho bộ phân loại auto mode | `claude-sonnet-5.5` | Ở auto mode, Claude Code gửi thêm một request kiểm tra an toàn (system prompt dài kèm transcript) cho mỗi tool call, bằng model chính. Gateway nhận ra request này và gửi lên Kiro bằng model đã chọn (chỉ khi model đó đã bật trong danh sách model). Để trống để giữ model của client. Lịch sử ghi tag `auto→model rẻ`. |
| Chỉ gửi / không gửi các tool | trống (gửi tất cả) | Định nghĩa tool được gửi lại ở **mọi** request (riêng tool có sẵn của Claude Code khoảng 25k token). Liệt kê tên tool cần giữ, ví dụ `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `Agent`; `*` là ký tự đại diện (`mcp__github__*`). Tool bị bỏ thì model không thấy và không gọi được; các lần gọi cũ của nó được chuyển thành text. Dialog chi tiết request liệt kê số token của từng tool. |

Riêng tư: cache câu trả lời chỉ nằm trong bộ nhớ Durable Object (tối đa 32 mục, mất khi khởi
động lại). Compact lưu **bản tóm tắt nội dung hội thoại** trong SQLite của Durable Object, xóa
sau min(retention, 7) ngày và xóa hết khi tắt compact. Vì vậy compact mặc định tắt.

Gợi ý thêm cho Claude Code (`~/.claude/settings.json` → `env`):

```json
{
  "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
  "CLAUDE_CODE_SUBAGENT_MODEL": "claude-haiku-4.5",
  "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "60"
}
```

- `DISABLE_NON_ESSENTIAL_MODEL_CALLS`: bỏ các request phụ không cần thiết.
- `CLAUDE_CODE_SUBAGENT_MODEL`: subagent dùng Haiku (phải có trong allowlist).
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`: Claude Code tự compact sớm hơn (phần trăm cửa sổ ngữ cảnh).
- Tắt MCP server không dùng (mỗi server thêm tool vào mọi request); dùng `/clear` khi đổi việc.

### Quản trị từ máy khác

```sh
gh repo clone <owner>/tg-gateway && cd tg-gateway
npm ci
npx wrangler login
npm run check && npm test && npm run test:integration
npm run deploy
```

Không chạy lại `npm run setup` khi đã có `VAULT_KEY` (script sẽ dừng để giữ token Kiro đang mã hóa). Secret nằm trên Cloudflare, dữ liệu trong Durable Object, nên máy mới không cần copy gì ngoài việc biết `GATEWAY_API_KEY` và `ADMIN_PASSWORD`.

`/v1/models` trả **allowlist cấu hình**, không phải xác nhận model khả dụng từ Kiro. Kiểm tra model trong tài khoản Kiro và cập nhật Settings.

## Chọn đường đi: Kiro, Claude thật, OpenRouter, deploy.com

Ngoài Kiro, gateway gọi được nhà cung cấp tương thích OpenAI. Chọn bằng tiền tố model ID trong **Settings → Model cho phép**:

| Tiền tố | Nhà cung cấp | Secret | Ví dụ |
| --- | --- | --- | --- |
| *(không có)* | Kiro | `KIRO_CREDENTIALS` | `claude-sonnet-4.5` |
| `anthropic/` | Anthropic API (Claude thật) | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-5-5` |
| `openrouter/` | OpenRouter | `OPENROUTER_API_KEY` | `openrouter/deepseek/deepseek-chat-v3.1` |
| `deploy/` | deploy.com | `DEPLOY_API_KEY` | `deploy/deepseek-ai/deepseek-v4.1-flash-1017` |

```sh
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put DEPLOY_API_KEY
```

- Gateway bỏ tiền tố trước khi gọi upstream. Client gọi đúng ID có tiền tố, ví dụ Claude Code: `ANTHROPIC_MODEL=openrouter/deepseek/deepseek-chat-v3.1`.
- Client Anthropic (Claude Code) được chuyển đổi sang chat completions: system, text, ảnh, tool call/tool result, `tool_choice`, `max_tokens`, `stop_sequences`, `temperature/top_p/top_k`. `thinking` thành `reasoning` (OpenRouter) hoặc `reasoning_effort: none` khi tắt (deploy.com). Nội dung reasoning trả về không được chuyển thành block thinking. Text stream liên tục; tool call được gom đủ rồi gửi một lần.
- Client OpenAI được chuyển tiếp nguyên trường, chỉ thay model.
- `anthropic/`: request Anthropic (`/v1/messages`) được chuyển tiếp **nguyên văn** tới `api.anthropic.com`, chỉ thay model và gắn `ANTHROPIC_API_KEY`; giữ `anthropic-version`/`anthropic-beta` của client; lỗi (429/529, `retry-after`) trả nguyên cho client. Client OpenAI gọi model `anthropic/...` nhận 400. Token gồm cả cache read/write.

**Đổi đường đi trong Claude Code** — mỗi model là một đường:

```sh
claude --model claude-sonnet-4.5                         # qua Kiro
claude --model anthropic/claude-sonnet-5-5               # Claude thật
claude --model openrouter/deepseek/deepseek-chat-v3.1    # OpenRouter
```

Trong phiên đang chạy dùng `/model <id>`; mặc định đặt bằng `ANTHROPIC_MODEL` trong `~/.claude/settings.json`. Model phải có trong allowlist ở Settings.
- Token lấy từ `usage` của nhà cung cấp (ghi là *reported*); OpenRouter trả thêm chi phí USD, lưu ở cột `cost_usd` và hiện cạnh credit trong lịch sử.
- Không qua Kiro nên không cần credentials Kiro và không có credit Kiro. Tool calling phụ thuộc model/nhà cung cấp: tài liệu deploy.com hiện không nói tới tool calling, nên Claude Code có thể không dùng được tool với model đó.

## Payload capture

Cài đặt → Dữ liệu & log. **Mặc định tắt.** Có hai chế độ: "Chỉ khi lỗi" (chỉ lưu request lỗi) và "Tất cả". Mỗi payload/response bị cắt ở 64 KB và được giữ N ngày theo cấu hình rồi bị dọn. Nội dung hiển thị trong dialog chi tiết của Lịch sử request.

**Lưu ý riêng tư:** payload có thể chứa mã nguồn và dữ liệu riêng tư của bạn. Chỉ bật khi cần gỡ lỗi, đặt thời gian giữ ngắn, và tắt khi xong. Chuyển về "Tắt" rồi lưu sẽ xóa toàn bộ payload đã lưu; payload cũng bị xóa cùng log của request.

Mỗi log request lưu kèm IP, quốc gia, thành phố và Cloudflare colo của client (để hiện nguồn request trong dialog chi tiết). Các thông tin này bị xóa cùng log (hết hạn retention hoặc "Xóa log").

## Token và credit: ý nghĩa số liệu

1. Nếu event upstream trả `inputTokens`/`outputTokens`, gateway ghi nhận token là **reported**.
2. Nếu không, input ước tính từ byte UTF-8 của payload / 4; output từ byte UTF-8 của text và tool calls / 4, làm tròn lên. Đây là heuristic, không phải tokenizer chính thức của Claude. Context usage percentage được lưu riêng, không biến thành token chính xác.
3. Credit quy đổi = `(input × inputCreditsPerMillion + output × outputCreditsPerMillion) / 1.000.000`.
4. Tỷ lệ mặc định bằng 0 vì chưa biết quy ước của bạn. Tự nhập trong Settings. Mỗi request lưu snapshot tỷ lệ; thay đổi sau này không viết lại lịch sử.
5. Credit Kiro là giá trị số `usage` trong `meteringEvent`. Thiếu event thì lưu `null`, UI hiển thị `—`; giá trị 0 thật vẫn hiển thị 0. Dashboard cho biết có số liệu ở bao nhiêu request.
6. **Credit Kiro không phải số dư, hóa đơn hoặc quota tài khoản.** Gateway chỉ biết request đi qua nó; request trực tiếp từ IDE/CLI không xuất hiện ở đây. Cần đối chiếu portal Kiro nếu cần số dư hoặc hóa đơn.
7. Stream kết thúc sạch nhưng thiếu `meteringEvent`/context event vẫn tính là thành công (200), kèm mã `no_completion_signal` trong lịch sử để dễ phát hiện khi giao thức Kiro thay đổi. Tool call bị cắt giữa chừng vẫn là lỗi. Stream lỗi/ngắt có thể chỉ ghi được phần token đã nhận. Không trả HTTP 200 thành công trong nhật ký nếu nhận lỗi sau khi bắt đầu SSE; HTTP headers thực tế của SSE đã gửi vẫn là 200, lỗi được trả qua event.
8. `monthlyCreditBudget` chỉ là mục tiêu theo dõi, **không chặn cứng chi phí**. Báo cáo tháng theo múi giờ của trình duyệt và dựa trên thống kê theo giờ (giữ vĩnh viễn).

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

Các file chính:

- `src/index.ts`: entry của Worker (chuyển `/api/*`, `/v1/*`, `/health` vào Durable Object, phục vụ static assets, gắn security headers/CSP).
- `src/gateway.ts`: Gateway Durable Object (`/v1/*`, `/api/*`, ledger, alarm dọn dữ liệu).
- `src/dashboard/api.ts`: các handler `/api/*` của console (overview, lịch sử, chi tiết, export, providers); `src/dashboard/period.ts`: khoảng ngày/tuần/tháng theo múi giờ; `src/dashboard/contract.ts`: kiểu dữ liệu dùng chung với `web/`.
- `src/db/schema.ts`: schema SQLite và migration; `src/db/stats.ts`: bảng thống kê theo giờ `stats_hourly`.
- `src/trace.ts`: các bước xử lý của request và payload capture.
- `src/stream-text.ts`: đọc lại SSE/JSON đã gửi cho client thành text dễ đọc (output trực tiếp, view "Đã ghép"); dùng chung cho Worker và `web/`.
- `src/upstream/kiro.ts`: gọi Kiro runtime; `src/upstream/quota.ts`: quota/credit của các nhà cung cấp.
- `src/protocol.ts` (chuyển đổi + binary parser), `src/kiro-auth.ts` (refresh + vault), `src/stream.ts` (SSE/JSON), `src/security.ts` (session/crypto).
- `web/`: console React, build ra `web/dist` và được Worker phục vụ qua `assets.directory`.

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
- `thinking`, `temperature`, `top_p`, `top_k` được chấp nhận nhưng **bỏ qua** (liệt kê trong header `x-gateway-ignored-params`). `stop` / `stop_sequences` được gateway tự áp dụng (Kiro không hỗ trợ): text bị cắt ở chuỗi dừng đầu tiên, phần Kiro gửi sau đó bị bỏ, trả về `stop_reason: "stop_sequence"` (Claude Code dùng tham số này cho bộ phân loại an toàn của auto mode). `response_format`, `seed` vẫn bị từ chối rõ ràng. `max_tokens`/`max_completion_tokens` chỉ là compatibility hint, **không áp đặt giới hạn output** vì chưa xác minh trường tương đương trong giao thức Kiro. Không dùng chúng để khống chế chi phí.
- Tool arguments được gom đầy đủ trước khi gửi tool block; text vẫn stream từng phần. Client tự thực thi tool.
- Giới hạn JSON đầu vào 1 MiB, dữ liệu stream tổng 16 MiB, timeout tối đa 600 giây, export CSV tối đa 5.000 dòng. Không tự retry 429/5xx để tránh ghi nhận/gọi model trùng; chỉ refresh và thử lại một lần khi upstream trả 401/403.
- Dashboard không tạo/sửa secret trên Cloudflare vì như vậy phải trao quyền Cloudflare API cho chính ứng dụng. Dùng script/CLI hoặc Cloudflare Dashboard.

Tham khảo giao thức: [jwadow/kiro-gateway](https://github.com/jwadow/kiro-gateway). License AGPL-3.0-or-later; xem `NOTICE` và `LICENSE`.
