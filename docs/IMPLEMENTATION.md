# Bàn giao triển khai — 03/10/2026

Kế hoạch được ghi vào PLAN.md trước khi bắt đầu code. BROWSER-RESEARCH.md bổ sung quan sát trực tiếp hai tab Chrome đã đăng nhập do người dùng cho phép khảo sát.

## Đã triển khai

- Electron + React + TypeScript, cấu hình build macOS/Windows, package-lock để npm ci.
- Tài khoản Messenger cá nhân, credential vault; session RAM riêng theo account, cookie snapshot mã hóa, browser sandbox/no Node/no preload trên Facebook.
- WebContentsView tabs, tab selection/close/reload, tách cửa sổ; thử thật trang login Facebook trong Chromium nhúng và popout trên macOS.
- Vault AES-GCM + OS safeStorage, atomic writes serialized, không plaintext fallback; corrupt/missing key không tự xóa dữ liệu. Credentials/cookies không xuất IPC snapshot.
- Multi-provider local/cloud: Ollama, LM Studio, OpenAI compatible, OpenAI, Anthropic, Gemini, DeepSeek, NVIDIA; API key encrypted/redacted, catalog phân trang, chọn/tìm model, ID tùy chỉnh, test provider, model mặc định và model theo 3 role kèm temperature/token. Cloud cần quyền bật riêng cho provider, mặc định tắt; local chuẩn hóa localhost, remote bắt buộc HTTPS, không redirect/fallback.
- Auto login theo form semantic, đợi hydration/SPA, khóa submit theo tài khoản, trạng thái lỗi/xác minh và retry; sửa tài khoản giữ password cũ khi bỏ trống.
- Bộ đọc Messenger semantic tích hợp; normalize NFC/NFD, inbox grid/link, message button labels, composer người nhận và nút gửi riêng. Profile generic là override nâng cao, có diagnostics/reset.
- Inbox discovery theo tài khoản, observer revision, polling và tiếp tục cuộn qua nhiều vòng; tự thêm thread mặc định auto tắt/opt-in cho thread phát hiện tiếp theo. Worker thread tải có giới hạn tối đa 59 tin. Baseline/cutoff/dedupe, raw storage, 9 tin recent + tối đa 50/batch summary, watermark revisions, summary cập nhật lúc quét hoặc trước generate, không mất raw khi AI fail.
- Scoped keyword knowledge retrieval + knowledge engine local; history truyền user/assistant có summary/knowledge riêng dưới dạng dữ liệu.
- Reply/proactive drafts cho đối tượng xác định, stale guards, pause abort/epoch, khóa thao tác browser theo account, ghi sending trước click, outgoing echo để xác nhận, uncertain không retry, giải quyết thủ công.

## Kiểm chứng

- Unit/integration tests: core context/cutoff/crypto/URLs/scope, jsdom fixture/preflight, AI transport/model role/pause/draft invalidation/uncertain, vault trên filesystem/restart/missing-key/corruption/IPC redaction.
- 47/47 kiểm thử thành công; TypeScript check, production build và format check đều qua.
- Smoke macOS: mở app, OS vault khởi tạo, lưu tài khoản test credentials trống, mở login trong tab Chromium, tách và đóng cửa sổ. Thử ở MASTER_CHAT_DATA_DIR=/private/tmp/master-chat-smoke-data, không nhập tài khoản thật. Tìm chuỗi tên test trên filesystem không thấy plaintext; file vault/key permission 0600.
- Chưa kiểm chứng model local thật vì chưa cấu hình runtime/model; test AI dùng transport giả lập cục bộ, không gửi nội dung hội thoại thật ra ngoài.
- Bản sửa được chạy lại trên vault hiện có: UI provider mới hiển thị, hai tài khoản được giữ, auto login tự điền/gửi form Facebook với tài khoản đã cấu hình. Facebook trả lỗi mật khẩu; app hiển thị đăng nhập thất bại và dừng retry. Chưa xác nhận đăng nhập thành công hoặc checkpoint/2FA/PIN thật; chưa kiểm chứng message arrival/send echo, Windows và installer ký số.
- AI transports/catalog/gate được test bằng fetch giả lập; UI provider/model được test bằng React + jsdom. Không dùng key cloud thật hoặc gửi history thật để kiểm tra AI trong lượt này.
- Cửa sổ thử đang mở dùng vault trong `/private/tmp/master-chat-smoke-data`; giữ mở vì có thao tác người dùng trong lúc thử. Chạy `npm run dev` thông thường dùng userData riêng, không tự chuyển dữ liệu thử sang vault chính.

## Việc còn lại để đạt toàn bộ phạm vi yêu cầu

1. Kiểm chứng incoming mới thật và gửi/echo với model thật trên hội thoại thử “Tôi là DEV”. Vault thử hiện có trong `/private/tmp/master-chat-smoke-data` được giữ riêng với vault mặc định; không tự nhập dữ liệu thử vào vault chính.
2. So sánh >=2 thread active/inactive, E2EE/PIN, inbox nhiều trang, kết quả dài hạn/restart. Quét không dựa riêng vào rank đầu nhưng chưa chứng minh mọi loại incoming nổi lên trên.
3. Requests/spam/archive, edit/delete invalidation, attachment/reaction/system-event semantics, đổi ngôn ngữ và reconciliation fingerprint khi nhãn ngày thay đổi.
4. Vector RAG local + model versioning, SQLCipher, retention/export/delete, xóa tài khoản, proactive scheduling, model/style riêng từng hội thoại.
5. Windows E2E và đóng gói ký số.

Không gọi kiểm thử bằng fixture là gửi Messenger thật thành công. Các hạn chế DOM, thời gian đến phút và coverage phải hiển thị cho người dùng.

## Luồng cấu hình AI sau bản sửa

Provider → thêm/sửa Base URL/API key → bật quyền cloud riêng nếu dùng endpoint từ xa → lưu & tải model → tick model cần sử dụng hoặc thêm ID → lưu & kiểm tra → Model theo tác vụ → chọn default/summary/knowledge/reply. Provider bị tắt/xóa hoặc model bị bỏ chọn làm assignment tương ứng được xóa; không tự đổi sang provider khác. Cấu hình local kiểu cũ được migrate và giữ lựa chọn model, credentials và dữ liệu hội thoại.

Lỗi API chỉ hiện HTTP status/thông báo an toàn, không đưa response body hoặc key vào UI. Snapshot trả hasApiKey/hasPassword, không trả secret.

## Nâng cấp Messenger cá nhân — 04/10/2026

Đã bỏ phạm vi fanpage theo cập nhật của người dùng. Kế hoạch nâng cấp ghi trong MESSENGER-UPGRADE.md trước khi sửa code. Khảo sát DOM công khai trên Chrome: nhãn tiếng Việt NFD, role=grid/row/link ở inbox; tin nằm trong button aria-label dưới article, không phải role=row; chưa thấy message ID nền tảng/time đầy đủ. Link đang chọn có aria-current=page; ô soạn có Viết cho <người>; nút Nhấn Enter để gửi riêng với Gửi lượt thích.

65 kiểm thử Node/jsdom/AI transport qua; TypeScript, format check và production build bản cuối đều qua. Luồng discovery → incoming vượt cutoff → native engine → AI → send đã được kiểm tra bằng mock, với gửi đúng một lần, replay không gửi thêm và pause chặn kết quả muộn. Không coi đây là chứng minh gửi thật.

Đã mở bản build trong Electron macOS trên vault thử có sẵn. Phiên SaoLa vào được Messenger và hiển thị trạng thái đã đăng nhập; inbox ban đầu đang hiển thị rỗng. Người dùng đang bổ sung Google Gemini; chưa chọn model khi kiểm tra. Không lấy key, cookie Chrome hay gửi history thật để kiểm thử trong đoạn này.

Chromium fixture riêng đã qua: inbox/read native, CDP input tạo sự kiện input, click đúng nút và outgoing echo; chặn draft người dùng, lệch selected thread, đổi account session và incoming chen vào sau khi nhập trước click. Chạy lại bằng `npm run test:browser`; toàn bộ trang/tin/cookie ở fixture là giả lập cục bộ, không gửi Facebook thật.

Cutoff thực tế lấy mốc lớn hơn giữa lần bật engine đầu tiên và lần theo dõi inbox đầu tiên của tài khoản. Hai mốc được giữ qua pause/restart. Inbox sâu được phát hiện muộn không được dùng cutoff cũ của tài khoản khác.

## Sửa lỗi tải lịch sử và chẩn đoán — 04/10/2026

Thông báo cũ “Hội thoại đổi trong khi hoàn tất tải lịch sử” gộp cả sai thread, lệch người nhận, modal/PIN và trùng định danh. Đã thay bằng lỗi riêng cho từng nguyên nhân, đồng thời đợi DOM sẵn sàng ở cả bước mở, cuộn lịch sử và trở lại tin mới nhất. Hộp thoại/control xác minh ẩn không được tính là chặn.

Nếu worker gặp hộp thoại/PIN thực sự, engine tạm dừng và hiện chính WebContents của worker trong cửa sổ riêng. Người dùng hoàn tất rồi đóng cửa sổ để nạp lại; đóng cửa sổ giữ worker và phiên trong bộ nhớ. Khi cửa sổ xác minh còn mở, đọc tự động và gửi đều bị chặn.

68 kiểm thử Node đã qua, cùng typecheck, format check, production build và Chromium fixture. Fixture kiểm tra cả modal ẩn, modal hiện, chặn gửi trong cửa sổ xác minh và đọc lại sau khi đóng cửa sổ; không gửi Facebook thật.


## PIN khôi phục Messenger local — 04/10/2026

Theo lựa chọn trực tiếp của người dùng, PIN được lưu cùng credentials trong vault mã hóa trên máy và được phép nhập vào trang Messenger chính thức; không gửi cho AI hay dịch vụ khác. Snapshot chỉ trả hasRecoveryPin cùng trạng thái bật/tắt/chặn thử; không trả mã. Không thêm file plaintext, localStorage, telemetry hoặc API mạng cho PIN.

Tài khoản → Sửa → PIN 6 chữ số → bật tự nhập → lưu. Để trống giữ PIN cũ; có lựa chọn xóa PIN. Tự nhập chỉ ở HTTPS Facebook /messages, đúng c_user của tài khoản, hộp thoại khôi phục PIN tiếng Việt/Anh, và control trống; không nhập mã OTP, tạo/đổi/reset PIN hay ghi đè thao tác thủ công. Hỗ trợ một input hoặc sáu ô maxlength=1, giữ số 0 đầu mã. Khôi phục thành công cần hộp thoại biến mất và nội dung Messenger sẵn sàng qua hai lần kiểm tra. Cửa sổ xác minh worker tự đóng sau thành công, giữ WebContents/session; không tự bật lại engine đang tạm dừng.

Trước khi điền, app lưu cờ chặn thử vào vault: PIN sai, timeout hoặc tiến trình bị ngắt không được thử tự động liên tục, kể cả sau restart. Người dùng cần kiểm tra Messenger hoặc nhập lại PIN và lưu để thử lại. Exception có thể chứa script nên luồng PIN chỉ dùng trạng thái cố định, không log/hiển thị exception gốc.

74 kiểm thử Node đạt, gồm vault roundtrip/không plaintext, snapshot bỏ PIN và kiểm tra payload summary/knowledge/reply không chứa PIN. Chromium fixture kiểm tra sáu ô, PIN sai, đồng thời nhiều lời gọi, chặn qua instance mới, opt-out và khôi phục cửa sổ worker. Đây là kiểm thử cục bộ bằng dữ liệu giả; chưa coi là chứng minh khôi phục Messenger thật bằng PIN của người dùng.
