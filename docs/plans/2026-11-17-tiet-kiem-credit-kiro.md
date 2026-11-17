# Plan: giảm credit Kiro (clear tool calls + compact + cache)

Ngày: 2026-11-17 · Phạm vi: chỉ đường **Kiro** (model không tiền tố). Đường `anthropic/`,
`openrouter/`, `deploy/` giữ nguyên, trừ phần timeout (bước 1).

## Bối cảnh

Review trước cho thấy gateway không tự gọi Kiro lặp, nhưng credit bị đốt vì:

1. Timeout tính trên **tổng** thời gian request (mặc định 180s) → câu trả lời dài bị cắt
   giữa chừng → Claude Code tự retry (tới ~10 lần), mỗi lần Kiro tính tiền lại.
2. Lỗi xảy ra **sau khi** Kiro đã trả 200 (đã tính tiền) vẫn trả 5xx → client retry.
3. Kiro bỏ qua `max_tokens`, nên request dò quota `max_tokens: 1` của Claude Code thành một
   lượt trả lời đầy đủ.
4. Mỗi lượt gửi lại **toàn bộ** ngữ cảnh: system prompt + tool + lịch sử, trong đó tool
   result (nội dung file, output lệnh) chiếm phần lớn. Kiro không có prompt caching để
   giảm giá phần lặp lại.

## Nghiên cứu

- **Clear tool calls**: mô phỏng chiến lược `clear_tool_uses_20250919` (context editing) của
  Anthropic: khi input vượt ngưỡng `trigger`, thay nội dung các tool result cũ bằng
  placeholder, giữ `keep` lần gọi tool gần nhất; tùy chọn `clear_tool_inputs` để xóa cả
  tham số gọi tool. Tool use và tool result luôn giữ thành cặp (cắt lệch cặp làm API báo
  lỗi 400).
- **Compact**: tóm tắt phần đầu hội thoại bằng model rẻ, giữ nguyên phần đuôi gần đây.
  Claude Code tự compact phía client dựa trên `input_tokens` gateway báo; gateway compact là
  lớp dự phòng cho client không tự compact và cho phiên agent dài.
- **Cache**: theo ghi chú của một dự án bên thứ ba, API Kiro/CodeWhisperer không có prompt
  caching và không trả số liệu cache. Dùng `conversationId` cố định (băm tin nhắn đầu) có
  rủi ro trộn ngữ cảnh giữa các phiên, nên **không làm**. Thay vào đó cache ở gateway:
  - cache câu trả lời cho request giống hệt từng byte (retry, request trùng);
  - gộp request giống hệt đang chạy song song (single-flight);
  - cache bản tóm tắt compact theo băm tiền tố hội thoại (tóm tắt một lần, dùng lại mọi lượt
    sau).

Nguồn: tài liệu context editing của Anthropic, ghi chú nghiên cứu harbangan về Kiro API,
PR #5 của kiro-claude-proxy (rủi ro conversationId cố định).

## Việc sẽ làm

### Bước 1: chặn vòng retry tốn tiền

- **Idle timeout**: `timeoutSeconds` đổi nghĩa thành "upstream im lặng quá N giây". Mỗi chunk
  nhận được từ upstream đặt lại đồng hồ. Thêm trần cứng 30 phút cho mỗi request. Áp dụng cả
  Kiro, OpenAI-compatible và `anthropic/`. Mặc định giữ 180s.
- **`x-should-retry: false`**: khi Kiro đã trả 200 (đã tính tiền) mà gateway vẫn lỗi (ví dụ
  tham số tool hỏng ở chế độ JSON), gắn header này để SDK Anthropic/OpenAI (Claude Code dùng
  SDK) không tự gửi lại. Lỗi trước khi Kiro tính tiền (5xx từ Kiro, mạng) vẫn cho retry.
- **`max_tokens: 1` trả lời tại chỗ**: request Kiro có `max_tokens`/`max_completion_tokens`
  bằng 1 được gateway trả lời ngay: nội dung rỗng, `stop_reason: max_tokens`,
  `finish_reason: length`, không gọi Kiro.

### Bước 2: tách cấu trúc hội thoại khỏi payload

`prepare()` trả về cấu trúc `{system, history, current, tools}`. Hàm `buildPayload()` ghép
thành payload Kiro (system vẫn chèn vào tin nhắn user đầu tiên như hiện tại). Các bước tối ưu
dưới đây sửa cấu trúc này trước khi build. Payload đầu ra khi tắt hết tối ưu phải giống hệt
hiện tại (có test).

### Bước 3: clear tool calls

Setting mới (mặc định):

| Setting | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `clearToolResults` | `true` | Bật xóa tool result cũ |
| `clearTriggerTokens` | `60000` | Chỉ xóa khi ước tính input vượt ngưỡng |
| `clearKeepToolUses` | `4` | Giữ nguyên N lần gọi tool gần nhất |
| `clearToolInputs` | `false` | Xóa cả chuỗi dài (> 300 ký tự) trong tham số tool cũ |

- Tool result của tin nhắn hiện tại không bao giờ bị xóa.
- Chỉ xóa result dài hơn 200 ký tự; result ngắn để nguyên.
- Placeholder: `[Tool result cleared by gateway to save context. Re-run the tool if you need
  it again.]`.
- Giữ nguyên `toolUseId`, cặp tool use/result và trạng thái lỗi/thành công.
- Kết quả xác định theo nội dung request, nên lượt sau cho cùng phần lịch sử ra cùng kết quả.

### Bước 4: compact (mặc định tắt)

Setting mới: `compactEnabled` (`false`), `compactTriggerTokens` (`120000`), `compactKeepTokens`
(`30000`), `compactModel` (`claude-haiku-4.5`, phải là model Kiro).

- Chạy sau bước clear. Nếu input vẫn vượt `compactTriggerTokens`:
  1. Tìm bản tóm tắt dài nhất đã lưu khớp tiền tố lịch sử. Mỗi tiền tố có một mã băm dạng
     chuỗi: `h_i = sha256(h_{i-1} + entry_i)`, tính trên lịch sử **gốc** (trước khi clear).
  2. Nếu vẫn vượt: chọn điểm cắt để phần đuôi ≤ `compactKeepTokens`, cắt tại một tin nhắn
     user. Tool result ở điểm cắt được chuyển thành text để không còn cặp tool bị lẻ.
  3. Gọi Kiro (model `compactModel`, không stream) để tóm tắt phần trước điểm cắt, kèm bản
     tóm tắt cũ nếu có. Lưu vào bảng `summaries`.
  4. Lịch sử gửi đi = system + tóm tắt + phần đuôi.
- Lỗi khi tóm tắt → bỏ qua compact, request vẫn chạy bình thường.
- Mỗi lần tóm tắt ghi một dòng riêng trong lịch sử request (`endpoint = internal:compact`)
  để thấy credit của nó.
- **Lưu ý riêng tư**: bản tóm tắt là nội dung hội thoại, lưu trong SQLite của Durable Object,
  xóa theo `retentionDays` (tối đa 7 ngày). Vì vậy mặc định tắt; README ghi rõ.

### Bước 5: cache câu trả lời + single-flight

Setting mới: `responseCacheSeconds` (`300`, 0 = tắt, tối đa 3600).

- Khóa cache = sha256 của payload Kiro cuối cùng, bỏ `conversationId`/`profileArn`.
- Chỉ cache request hoàn tất thành công. Lưu trong **bộ nhớ** Durable Object, không ghi đĩa;
  tối đa 32 mục, mỗi mục ≤ 2 MB. Mất khi Durable Object khởi động lại.
- Request giống hệt đến khi request đầu đang chạy: chờ kết quả rồi phát lại. Request đầu lỗi
  → request chờ tự gọi Kiro.
- Cache hit: phát lại dạng stream hoặc JSON theo request, header `x-gateway-cache: hit`, ghi
  0 credit.

### Bước 6: ledger, dashboard, tài liệu

- Cột mới `optimizations` (text) và `saved_tokens` (số) trong `requests`. Lịch sử request
  hiển thị ví dụ "Xóa 12 tool result · −35k token", "Cache", "Compact", "Trả lời tại chỗ".
- Tổng quan: thêm số token đã tiết kiệm trong kỳ.
- Cài đặt: nhóm "Tiết kiệm credit" chứa các setting mới. Form hỗ trợ checkbox/text tổng quát.
- README: mô tả tính năng. Gợi ý biến môi trường Claude Code: `DISABLE_NON_ESSENTIAL_MODEL_CALLS=1`,
  `CLAUDE_CODE_SUBAGENT_MODEL=claude-haiku-4.5`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`.

## Không làm

- `conversationId` cố định: rủi ro trộn ngữ cảnh, không có bằng chứng Kiro cache theo nó.
- Đổi lỗi giữa stream thành loại không retry: có thể làm sai lệch cách client xử lý lỗi.

## Kiểm thử

- Unit test cho từng bước: idle timeout, `max_tokens: 1`, `buildPayload` giữ nguyên payload,
  clear (ngưỡng, keep, giữ cặp, không đụng tin hiện tại, xác định), compact (điểm cắt, chuyển
  tool result thành text, tái dùng tóm tắt, lỗi thì bỏ qua), cache (hit, hết hạn, giới hạn
  kích thước, single-flight), `validateSettings` với field mới.
- `npm run check && npm test && npm run test:integration`.
- Mỗi bước một commit, push lên `claude/loving-wozniak-u3czwz`.
