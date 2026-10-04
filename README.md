# Master Chat

Ứng dụng Electron cho Messenger cá nhân, với AI local/cloud do người dùng chọn và dữ liệu mã hóa trên thiết bị. Bản 0.1 đã có bộ đọc Messenger cá nhân tích hợp và luồng phát hiện/tự trả lời; kiểm chứng gửi thật trên tài khoản người dùng vẫn cần hoàn tất trước khi vận hành.

## Chạy ứng dụng

```sh
npm ci
npm run dev
```

Node.js 22.12+ (hoặc Node 24/25), macOS/Windows. Chromium nằm trong Electron, không cần cài thêm trình duyệt Playwright. Electron được tải qua postinstall của package chính thức.

Kiểm tra và đóng gói:

```sh
npm test
npm run test:browser # Chromium fixture cục bộ
npm run typecheck
npm run format:check
npm run build
npm run dist:mac
npm run dist:win
```

Các cấu hình builder đã có; chưa tạo installer ký số và chưa chạy thử Windows. Không coi việc compile thành công là đã kiểm chứng Facebook hoặc installer trên mọi OS.

## Sử dụng bản nền tảng

1. **Tài khoản**: thêm Messenger cá nhân. Có thể để credentials trống để đăng nhập thủ công. Có nút sửa tài khoản; để trống mật khẩu khi sửa sẽ giữ mật khẩu đã lưu. App tự điền/gửi form Facebook sau khi form sẵn sàng, báo lỗi đăng nhập/xác minh và có nút “Đăng nhập lại”. Mật khẩu/cookies không trả lại renderer.
2. **Trình duyệt**: mở inbox trong tab Chromium, mở nhiều tab hoặc tách cửa sổ. Phiên riêng theo account; không nhập/copy session Chrome thật đang dùng. Thông tin đăng nhập được lưu trong vault nếu bạn nhập tại cấu hình.
3. **Cấu hình AI**: mục **Provider** hỗ trợ Ollama, LM Studio, OpenAI compatible, OpenAI, Anthropic, Google Gemini, DeepSeek và NVIDIA. OpenAI/Claude/Gemini/DeepSeek có sẵn catalog model văn bản và mô tả từ file `llm-models.json` sao chép nguyên từ SEO Expert để tick chọn ngay, không cần gọi API trước. Quyền sử dụng model tùy tài khoản. Với NVIDIA hoặc server local/compatible, chọn “Lưu & tải danh sách model” để lấy model trên server; nút này cũng tải thêm model cho provider cloud. Có thể nhập ID tùy chỉnh rồi kiểm tra kết nối. Mục **Model theo tác vụ** chọn provider + model mặc định và override cho summary/knowledge/reply; hỗ trợ temperature/token đầu ra. API key khi sửa để trống được giữ nguyên, có checkbox xóa riêng. Provider cloud mặc định bị chặn; bạn phải bật **Cho phép AI cloud cho provider này** trước khi kết nối. Không theo redirect hoặc fallback sang provider khác.

4. **Hội thoại**: chọn **Quét inbox** để tự thêm các thread từ Messenger. Mặc định chỉ theo dõi; bật auto riêng từng hội thoại. Có quyền theo tài khoản để các thread phát hiện từ lần quét tiếp theo tự bật auto; các thread đã có giữ lựa chọn riêng. Có thể thêm URL thủ công; tên phải khớp người nhận trên Messenger khi dùng bộ đọc tích hợp.
5. **Bộ đọc trình duyệt**: mặc định dùng Messenger tích hợp với DOM semantic đã khảo sát trên giao diện tiếng Việt. Không cần nhập CSS. Profile tùy chỉnh dành cho trường hợp nâng cao; mẫu chỉ dùng cho fixture. Profile cũ còn lưu sẽ tiếp tục được dùng; chọn **Dùng bộ đọc Messenger tích hợp** để bỏ override. **Nạp lịch sử** hoạt động khi paused và không gửi tin: tải có giới hạn tối đa 59 tin (9 gần nhất + 50 phần cũ) từ các trang DOM Facebook cung cấp.
6. **Tiếp tục**: ghi mốc đầu tiên một lần, khởi động vòng quét mỗi 6 giây. Vòng đang chạy không chồng lấn; nhiều thread hoặc tải chậm có thể làm thời gian giữa các lần kiểm tra dài hơn. Monitor riêng luôn quét phần đầu inbox rồi tiếp tục vùng phía dưới qua nhiều vòng; UI báo phần chưa phủ. Worker đọc thread riêng, không chuyển/scroll tab người dùng. Baseline chỉ lưu; unread/rank không cấp quyền trả lời. Tin trước cutoff, thiếu ngày giờ hoặc thuộc phút chứa cutoff không tự trả lời. Cutoff lấy mốc lớn hơn giữa lần bật engine và lần theo dõi tài khoản đầu tiên, lưu qua pause/restart; app khởi động paused.
7. **Tri thức**: nhập text local và chọn scope account hoặc dùng chung. Bản đầu truy xuất từ khóa; vector RAG ở giai đoạn sau.
8. **Bắt chuyện trước**: chọn hội thoại, nhập mục tiêu rồi tạo nháp; sửa/xem nháp trước khi gửi. Không có gửi hàng loạt. Cần resume; profile tùy chỉnh phải verified nếu sử dụng. Bộ đọc tích hợp kiểm tra phiên tài khoản, URL, link đang chọn, nhãn người nhận trong composer, ID tin cuối và outgoing echo.

## Dữ liệu và bảo mật

Vault ở thư mục `secure` bên trong `app.getPath('userData')`. Nội dung mã hóa AES-256-GCM; khóa ngẫu nhiên được bảo vệ bằng Electron safeStorage (Keychain/DPAPI). Không fallback plaintext. Nếu mất khóa/corrupt, app báo lỗi và giữ file; không reset âm thầm. Đây là bảo vệ dữ liệu trên đĩa, không chống malware chạy cùng quyền user hay truy cập bộ nhớ tiến trình.

Browser session không persist và HTTP cache tắt. Cookies được snapshot mã hóa; localStorage không lưu bền. Vì vậy Facebook có thể cần đăng nhập/PIN/E2EE lại sau restart. Không dùng crash upload/telemetry hoặc server của ứng dụng. Messenger vẫn kết nối Facebook để đọc/gửi tin; AI local server phải được cấu hình không forward cloud nếu bạn muốn giữ ngữ cảnh trên máy. Khi bật cloud riêng cho một provider, ngữ cảnh cần thiết được gửi trực tiếp tới endpoint bạn cấu hình (không đi qua server Master Chat); credentials Facebook/cookies không gửi cho AI.

Khi gửi lỗi/timeout sau khi bắt đầu thao tác, trạng thái là **uncertain**, không tự retry. Kiểm tra trình duyệt rồi chọn “Tôi xác nhận đã gửi” hoặc “Chưa gửi, bỏ nháp”. Cả hai dừng engine và loại trigger khỏi hàng đợi; không tự gửi lại.

## Trạng thái chính xác

- Đã có UI desktop, encrypted vault, tabs/popout, multi-provider AI/task model selection, raw history, incremental summary, local keyword knowledge, baseline/cutoff/dedupe/pause, reply/proactive drafts và outbox guards.
- Inbox discovery, DOM MutationObserver làm dấu hiệu thay đổi, polling dự phòng, cuộn có giới hạn và tải ngữ cảnh đã nối với engine. Requests/spam/archive chưa được quét; không bảo đảm bao phủ mọi hộp thư.
- DOM thật đã khảo sát qua DevTools UI, không dùng endpoint Facebook nội bộ hoặc sao chép cookie Chrome. Giao diện khảo sát không có ID message nền tảng: bộ đọc dùng fingerprint nội dung/hướng/thời gian; tin trùng hoàn toàn trong cùng phút bị chặn. Nhãn thứ/ngày không có năm rõ ràng chỉ giữ raw, không suy đoán timestamp. Thay đổi nhãn qua ngày, edit/delete, attachment và bản dịch khác còn cần reconciliation; chưa coi adapter này là bảo đảm vận hành lâu dài.
- Luồng đọc/gửi, cutoff, pause và discovery đã kiểm thử bằng DOM/transport mô phỏng. Chưa chứng minh tự trả lời thật với model thật và incoming thử trên tài khoản app.
- Còn thiếu vector embeddings local/SQLCipher, reconciliation edit/delete/attachments, scheduler proactive, profile/policy riêng theo đối tượng, xóa tài khoản và retention/export; xem các giai đoạn trong kế hoạch.

Chi tiết: [kế hoạch](docs/PLAN.md), [khảo sát trình duyệt thật](docs/BROWSER-RESEARCH.md), [bàn giao triển khai](docs/IMPLEMENTATION.md), [nâng cấp Messenger](docs/MESSENGER-UPGRADE.md).
