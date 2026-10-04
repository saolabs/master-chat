# Master Chat — kế hoạch và hợp đồng triển khai

Ngày: 03/10/2026; cập nhật phạm vi 04/10/2026 (chỉ Messenger cá nhân). Ứng dụng desktop cá nhân, Windows/macOS; dữ liệu nghiệp vụ trên thiết bị.

## 1. Phạm vi và các quyết định đã chốt

- Electron + React + TypeScript. Chromium có sẵn trong Electron; dùng WebContentsView cho tab/cửa sổ thật. Bộ điều khiển DOM/CDP nằm main process. Kiểm thử bằng Node/jsdom và Chromium fixture riêng của Electron, không cần mở thêm trình duyệt để điều khiển cùng phiên.
- Adapter hiện tại `messenger-personal`; mở rộng Zalo web/API bằng cùng hợp đồng. Không gọi endpoint Facebook nội bộ/không công khai.
- URL gốc hiện tại: https://www.facebook.com/messages/. Fanpage đã bỏ khỏi app theo cập nhật của người dùng; khảo sát Business trước đây giữ làm lịch sử nghiên cứu. Redirect khi mở URL không xác định mục cần xử lý. Điều hướng phải kiểm tra ID trước khi đọc/gửi.
- Không có backend, đồng bộ cloud, analytics, crash upload. Sau xác nhận của người dùng ngày 03/10/2026, AI cloud được phép chỉ khi người dùng bật quyền riêng cho provider đó, mặc định tắt. AI local nhận loopback IP và chuẩn hóa localhost thành 127.0.0.1; AI từ xa bắt buộc HTTPS. Không theo redirect hoặc fallback tới provider khác. Credentials Facebook/cookies không gửi tới AI.
- Dữ liệu lưu trữ ở trên máy. Khi bật cloud cho provider, history/summary/knowledge cần thiết gửi trực tiếp tới endpoint đã cấu hình. Người dùng cần giữ tắt cloud forwarding ở server local nếu muốn ngữ cảnh không ra ngoài.
- Tự động hóa mặc định dừng. Từng hội thoại bật auto-reply riêng. Giao diện hiển thị tab đích, mốc bắt đầu, trạng thái, bản nháp và lỗi.

## 2. Nghiên cứu hai dự án tham chiếu

### ../seo-expert

Đã đọc `src/lib/llm/registry.ts:resolveModel`, `src/lib/agents/run-agent.ts:resolveAgentModel`, `src/lib/llm/model-task-catalog.ts`, UI project-model-settings.

Kế thừa thiết kế: provider có base URL, model selection theo role, default/inheritance, hiển thị model hiệu lực và báo lỗi khi không có model. Không mang multi-tenant DB, worker BullMQ và quota vào app cá nhân. Tách summary/knowledge/reply, không tự thay model ngoài cấu hình.

### ../seo-auto-tool

Đã nghiên cứu `electron/campaign-engine.ts:openUrlBrowserWindow/controlUrlBrowser`, `electron/main.ts:createMainWindow`, `electron/session-store.ts:saveSession/loadSession`, campaign pause/resume.

Kế thừa: WebContentsView + sandbox/contextIsolation/no Node, main/preload IPC, session theo partition, cửa sổ resize, native notifications, safeStorage + ghi atomic. Khác biệt: master-chat dùng session trong RAM và lưu cookies đã mã hóa; không để Chromium lưu localStorage/chat/cache plaintext. Tạm dừng vô hiệu hóa công việc đang chạy và kiểm tra lại sát thời điểm gửi.

Graph codebase-memory của seo-auto-tool có line range cũ; CodeGraph trả source hiện tại. Không chỉnh sửa dự án tham chiếu.

## 3. Bằng chứng trình duyệt và giới hạn đã biết

Nguồn chính thức:
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/api/safe-storage
- https://www.electronjs.org/docs/latest/api/session
- https://playwright.dev/docs/api/class-electron (Electron support còn experimental)
- https://www.facebook.com/help/1071984682876123

Kiểm tra công khai: URL Messenger cá nhân redirect login.php; Business Inbox không đọc được qua truy cập công khai. Chưa có bằng chứng có phiên đăng nhập rằng mọi tin mới đều nổi lên đầu. DOM, inbox ảo hóa, requests/spam/archive, timestamp và chiều tin phải được kiểm tra trên tài khoản thật. Khảo sát DOM công khai ngày 04/10 đã bổ sung bộ đọc semantic; xem BROWSER-RESEARCH.md và MESSENGER-UPGRADE.md. Không viết selector đoán rồi tuyên bố auto-reply production đã hoạt động.

Tách bộ đọc khỏi engine. Messenger tích hợp là mặc định; profile JSON là override nâng cao, có đọc thử/diagnostics và chặn auto-send nếu profile chưa verify. Profile cần chỉ rõ ID, direction, text, timestamp ISO hoặc epoch-ms, thread identity và composer. Profile fixture chỉ để test, không dùng giả làm Facebook selector.

## 4. Phát hiện tin mới và chống trả lời tin cũ

1. Ghi `enabledAt` khi người dùng bắt đầu lần đầu; không đổi mốc khi pause/resume/restart. Cutoff theo tài khoản là mốc lớn hơn giữa enabledAt và monitorStartedAt (lần theo dõi inbox đầu tiên), giữ qua pause/restart. Tin baseline không bao giờ trở thành mới.
2. Lần quét đầu mỗi hội thoại = baseline. Lưu nguyên văn, không enqueue trả lời. Ưu tiên platform message ID; bộ đọc semantic fallback fingerprint khi DOM không cung cấp ID, chặn trùng hoàn toàn trong cùng phút. Tin phải có thread ID + hướng + thời gian đáng tin cậy; thiếu dữ liệu -> lưu diagnostics, không suy đoán thời gian từ lúc quét.
3. Theo dõi thay đổi danh sách và DOM; polling định kỳ là đường dự phòng. Baseline/dedupe theo account/platform/thread/message ID; unread chỉ là tín hiệu ưu tiên, không phải quyền gửi.
4. Monitor inbox độc lập với tab người dùng. Quét các thread đã biết và thread thay đổi; dùng cửa sổ/tab automation riêng, không cướp điều hướng tab người dùng. Danh sách ảo hóa cần scroll reconciliation; chưa cover hết thì báo `partial`, không báo đã đồng bộ tất cả.
5. Mỗi thread xử lý tuần tự; gom burst incoming, lấy toàn bộ batch mới hơn mốc. Tin outgoing của người dùng làm nháp hết hiệu lực. Tin lịch sử tải muộn nhưng trước mốc vẫn bị chặn.
6. Trước gửi: account đúng, ID thread đúng, latest message ID đúng, automation không paused, auto-reply bật, profile tùy chỉnh đã verify nếu dùng, không còn challenge, draft chưa hết hiệu lực.
7. Outbox: draft -> sending -> sent hoặc uncertain. Ghi `sending` bền vững trước thao tác; timeout/crash sau click -> uncertain, không retry tự động vì chưa biết Facebook đã nhận hay chưa. Đối chiếu echo outgoing/ID để xác nhận; exactly-once không bảo đảm chỉ bằng browser.
8. Resume không replay tin cũ/baseline; restart chuyển sending dở thành uncertain và khởi động paused.

## 5. History + tóm tắt tăng dần

Đánh số từ mới nhất: 1..9 giữ nguyên văn, số 10 trở về trước là phần có thể tóm tắt. Khởi tạo nạp tối đa 59 tin (9 gần nhất + tối đa 50 tin cũ), theo thứ tự cũ -> mới. Hội thoại <=9 tin không cần summary. Mỗi tin mới làm một hoặc nhiều tin vượt qua cửa sổ 9 tin; chỉ gửi phần chưa covered + summary cũ cho summary engine.

Summary có `coveredMessageIds`, revision và facts/commitments/open questions. Cập nhật summary và watermark cùng transaction; failure giữ summary cũ và raw pending, không bỏ ngữ cảnh. Summary backlog được giới hạn mỗi batch 50 nhưng không bỏ phần còn lại. Edit/delete cần invalidation/rebuild; không dùng summary cũ như bằng chứng tuyệt đối. Bản đầu xử lý immutable message ID; reconciliation edit/delete thuộc giai đoạn tiếp theo.

Reply prompt: policy + summary có provenance + knowledge liên quan + history structured user/assistant; không biến tin của đối tượng thành system instruction. RAG mở rộng context theo nhu cầu, không kéo lại qua browser. Raw store là nguồn gốc, summary/vector đều có thể dựng lại.

## 6. Lưu trữ và bảo mật

Bản đầu: vault JSON AES-256-GCM, key ngẫu nhiên được bọc bằng Electron safeStorage; credentials, cookies, raw messages, summary, knowledge, drafts trong cùng vault. Ghi atomic/queue, file permission 0600. Không fallback plaintext khi OS key store không khả dụng. Lỗi giải mã/corrupt báo lỗi, không âm thầm tạo DB mới.

Phiên Chromium không persist; cache=false, chặn download, permissions deny, không có preload trên Facebook. Cookie snapshot mã hóa, session RAM dùng chung các tab cùng account. Cookies httpOnly được khôi phục có domain/path/secure/sameSite; localStorage không persist nên Facebook có thể yêu cầu lại khóa PIN/E2EE/xác minh. Đây là đánh đổi có chủ ý để không lưu chat plaintext trong browser profile. Session OS/Chromium process memory có thể xuất hiện trong swap/crash do hệ điều hành; không hứa chống malware cùng user.

Bản mở rộng: SQLite + SQLCipher (FTS/vector nằm bên trong encrypted DB), migration versioned, incremental transactions, retention/export/delete/wipe. Không dùng SQLite plaintext + chỉ mã hóa mật khẩu. IPC allowlist, xác thực sender main-frame, schema validation, giới hạn payload. Renderer không nhận lại passwords/cookies/key.

RAG bản đầu: tìm kiếm từ khóa trên vault decrypted trong RAM, giới hạn account/thread. Knowledge engine tìm trong kho người dùng cung cấp, không web-search. Vector embeddings local + model/version provenance triển khai tiếp; khi đổi model rebuild, không so vector khác không gian.

## 7. UI và các luồng

- Cột tài khoản: thêm Messenger cá nhân, tên, credentials được bảo vệ, mở inbox, tab/cửa sổ.
- Trình duyệt: nhiều tab theo account, đóng/chọn, tách cửa sổ; hiển thị URL hiện tại. Khi thao tác thủ công pause engine.
- Hội thoại: raw history local, summary, bật auto-reply từng người, mở đúng thread.
- AI: danh sách nhiều provider, catalog model lấy trực tiếp từ endpoint, chọn/tìm model, ID tùy chỉnh; model mặc định và override theo 3 role cùng temperature/token. API key mã hóa, không trả snapshot; kiểm tra kết nối từng provider.
- Knowledge: nhập tài liệu text, tìm kiếm local theo scope.
- Chủ động: chọn một hội thoại hoặc thread URL xác định, nhập mục tiêu, tạo nháp AI, xem/chỉnh/sent. Không tự suy ra người nhận từ tên và không mass outreach.
- Login: chỉ điền form email/pass tại host Facebook cho phép, đợi form sẵn sàng sau hydration/SPA; khóa submit theo tài khoản; lỗi không retry liên tục. Sửa credentials và “Đăng nhập lại” cho phép thử lại. URL/DOM checkpoint/2FA -> dừng và thông báo. Không giải CAPTCHA, không tự gửi mã OTP.

## 8. Các giai đoạn và tiêu chí nghiệm thu

### A — nền tảng có thể chạy và test (triển khai ngay)

Electron/React, account vault, local AI, browser tabs/popout, login/challenge notification, adapter contract + profile calibration, raw/summary/window engine, baseline/cutoff/pause/dedupe/outbox, knowledge keyword retrieval, reply/proactive drafts. Unit tests các invariant và DOM fixture tests. Typecheck/build và smoke Electron trên macOS hiện có.

### B — kiểm chứng Facebook có đăng nhập

Hiệu chỉnh Messenger cá nhân, phiên account và selected-thread/composer identity, DOM tests bằng mẫu đã ẩn thông tin nhạy cảm. Kiểm tra >=2 hội thoại nhận tin liên tiếp, inactive/active, unread trước cutoff, read-on-open, restart, redirect, requests/spam/archive, danh sách ảo hóa, E2EE PIN, attachment/reaction/edit/delete. Chỉ vận hành auto-send sau kiểm chứng bộ đọc và echo outgoing trong phiên thử; override profile phải verified. Cần tài khoản và tương tác gửi tin thử; chưa thể xác nhận chỉ từ source code hay trang login công khai.

### C — hoàn thiện dữ liệu và phát hành

SQLCipher migrations + vectors local, restore/backup/delete, scoped knowledge sources, per-thread style/model override, scheduler proactive single-recipient, notification tray, signed dmg/nsis, packaging test Windows và macOS, threat model / profile compatibility updates. Không coi build trên Mac là xác nhận installer Windows.

## 9. Test bắt buộc

Baseline không gửi; unread cũ/cutoff/missing timestamp không gửi; trùng ID không gửi lại; <=9 không summary; msg10 summary đúng một lần; burst nhiều tin; summary failure không mất raw; pause lúc AI đang chạy không gửi; người dùng đổi thread/outgoing invalidates draft; crash sending -> uncertain; AI remote bị chặn khi chưa bật quyền trên provider; redirect bị chặn; credential không xuất snapshot; corrupt vault không reset; ID account/thread tách biệt; DOM active thread mismatch không click composer.

## 10. Nghiên cứu bổ sung và bản sửa đăng nhập/provider

Đã đọc thêm source hiện tại của `seo-expert/src/components/llm/add-provider-dialog.tsx` (ProviderDialog), `agent-model-matrix.tsx` và `src/lib/admin/provider-model-discovery.ts`. Áp dụng danh sách provider có bật/tắt/sửa/xóa, API key không đổ ngược vào form, catalog trực tiếp có phân trang Gemini/Anthropic, model checkbox/filter/custom ID, test model, và lựa chọn provider-model + mặc định theo tác vụ. API message native cho Gemini/Anthropic; các provider còn lại dùng OpenAI-compatible chat. Không hardcode các ID model cloud có thể thay đổi.

Lỗi auto login trước đây: chỉ query input[name=email]/input[name=pass]/button[name=login], chỉ chạy ở pathname chứa login, đánh dấu attempt trước khi tìm thấy form; không theo dõi hydration/SPA hay sửa credentials. Bản sửa nhận field password/email và nút theo role/text, readiness polling 1,5 giây + dom-ready/in-page navigation, credential hiện tại trong vault, thông báo trạng thái/retry. DOM script tự chứa toàn bộ helper để chạy đúng sau bundling. Không ghi credential/log vào snapshot.

Nguồn giao thức:
- [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents/)
- [OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)
- [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list)
- [Gemini generateContent](https://ai.google.dev/api/generate-content)
- [Gemini Models](https://ai.google.dev/api/models)
