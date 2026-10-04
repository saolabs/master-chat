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

4. **Hội thoại**: chọn **Quét inbox** để tự thêm các thread từ Messenger. Mặc định chỉ theo dõi; bật auto riêng từng hội thoại. Có quyền theo tài khoản để các thread phát hiện từ lần quét tiếp theo tự bật auto; các thread đã có giữ lựa chọn riêng. Trong **Quản lý inbox**, nút **Bật tự trả lời toàn bộ** áp dụng cho hội thoại hiện có và mới của từng tài khoản; sau đó bấm **Tiếp tục** để trả lời tin mới trong nền mà không cần mở từng hội thoại. Có thể thêm URL thủ công; tên phải khớp người nhận trên Messenger khi dùng bộ đọc tích hợp.
5. **Bộ đọc trình duyệt**: mặc định dùng Messenger tích hợp với DOM semantic đã khảo sát trên giao diện tiếng Việt. Không cần nhập CSS. Profile tùy chỉnh dành cho trường hợp nâng cao; mẫu chỉ dùng cho fixture. Profile cũ còn lưu sẽ tiếp tục được dùng; chọn **Dùng bộ đọc Messenger tích hợp** để bỏ override. **Nạp lịch sử** hoạt động khi paused và không gửi tin: tải có giới hạn tối đa 59 tin (9 gần nhất + 50 phần cũ) từ các trang DOM Facebook cung cấp.
6. **Tiếp tục**: ghi mốc đầu tiên một lần, khởi động vòng quét có nhịp 2 giây và xử lý tối đa 4 hội thoại mỗi lượt theo ưu tiên/luân phiên. Hội thoại đang xem có live view riêng đọc khoảng mỗi giây, kể cả khi paused; khi paused không tự gọi AI/gửi. Vòng đang chạy không chồng lấn; nhiều thread hoặc tải chậm có thể làm thời gian giữa các lần kiểm tra dài hơn. Monitor riêng luôn quét phần đầu inbox rồi tiếp tục vùng phía dưới qua nhiều vòng; UI báo phần chưa phủ. Worker đọc thread riêng, không chuyển/scroll tab người dùng. Baseline chỉ lưu; unread/rank không cấp quyền trả lời. Tin trước cutoff, thiếu ngày giờ hoặc thuộc phút chứa cutoff không tự trả lời. Cutoff lấy mốc lớn hơn giữa lần bật engine và lần theo dõi tài khoản đầu tiên, lưu qua pause/restart; app khởi động paused.
7. **Tri thức**: danh sách nguồn toàn chiều rộng; bấm **Thêm nội dung** để nhập văn bản hoặc **Nhập tài liệu** để chọn nhiều PDF, DOC, DOCX, HTML/HTM, TXT, MD/Markdown. Có thể kéo thả file vào kho. Xem và sửa tên/nội dung trích xuất, chọn phạm vi tài khoản hoặc dùng chung, rồi lưu cả đợt; nguồn đã lưu có tìm kiếm, lọc phạm vi, sửa và xóa. Đọc tài liệu trên máy, không cần Word/LibreOffice hoặc gọi AI. Giới hạn 30 file/đợt, 20 MB/file, tổng 100 MB, 100.000 ký tự/nguồn; vượt giới hạn báo lỗi, không âm thầm cắt nội dung. PDF scan cần OCR trước, tài liệu có mật khẩu cần mở khóa; TXT/Markdown hỗ trợ UTF-8 hoặc UTF-16 có BOM. Bản đầu truy xuất từ khóa; vector RAG ở giai đoạn sau.
8. **Soạn và gửi**: nhập tin ngay dưới lịch sử, bấm **Gửi** hoặc Enter; Shift+Enter xuống dòng. Gửi thủ công dùng được khi tự động đang tạm dừng và không cần gọi AI. **Tạo bản nháp** đưa nội dung AI vào cùng ô soạn để sửa/gửi; tùy chọn **Gửi ngay sau khi tạo nháp** mặc định tắt. Tin đang soạn được giữ riêng theo hội thoại trong phiên ứng dụng; AI nhường hội thoại đó và tiếp tục xử lý các hội thoại khác. **Xóa nội dung** bỏ nháp chưa gửi. Có thể nhập mục tiêu để bắt chuyện trước. Không có gửi hàng loạt; profile tùy chỉnh phải verified nếu sử dụng. Bộ đọc tích hợp kiểm tra phiên tài khoản, URL, link đang chọn, nhãn người nhận trong composer, ID tin cuối và outgoing echo.

## Phong cách, media và tốc độ gõ

Trong **Cấu hình AI → Phong cách & nhịp trả lời**, mọi trường đều tùy chọn:

- Mô tả bản thân, tính cách và instructions chung. Để trống vẫn tạo được phản hồi.
- Mỗi hội thoại có hồ sơ quan hệ, xưng hô, phong cách và dữ kiện kèm ID tin dẫn chứng. Dựng từ ít nhất 50 tin có nội dung của hai phía; phong cách chỉ học từ tin chủ tài khoản tự gửi, loại tin AI. Dùng toàn bộ lịch sử có sẵn qua các phần tối đa 100 tin/32.000 ký tự, cập nhật khi thêm 10 tin; thiếu dữ liệu hoặc lỗi thì dùng phong cách chung. Trong Trợ lý AI có thể nạp thêm lịch sử, dựng lại và xem tin dẫn chứng.
- **Ngữ cảnh quan hệ** và **Định hướng trò chuyện** là hai ô riêng, đều tùy chọn: ô đầu bổ sung dữ kiện giữa hai người, ô sau đặt mục tiêu dài hạn. Tin mới nhất luôn ưu tiên; không ép mục tiêu hoặc chuyện cũ vào mỗi tin. Phong cách riêng do chủ tài khoản đặt vẫn ưu tiên hơn phong cách học.
- **Kiểm tra độ tự nhiên** dùng model khác model viết. Nếu để trống, chỉ tự chọn model khác đã bật trong cùng provider trả lời; chưa có model khác thì ghi rõ chưa kiểm tra. Có thể chọn model/provider riêng theo quyền đã cấu hình, bật/tắt tùy ý. Bộ kiểm tra trả approve/revise/hold, nháp sửa được kiểm tra lại một lần; hold/lỗi/JSON sai giữ nháp để người dùng xem, không tự gửi. Người dùng vẫn có thể sửa và gửi thủ công. Bước này thêm 1–2 lượt gọi AI và không bảo đảm mọi phản hồi đều chính xác.
- Lịch sử lưu cả bản chép âm thanh trong metadata của tin gốc (không ghi đè nội dung/ID Messenger). Tìm kiếm toàn bộ tin local gồm bản chép; bấm Hiện thêm tin đã lưu để xem quá 50 tin. Đồng bộ hoặc mở lại ứng dụng giữ kết quả đã lưu, không phiên âm lại.
- Đọc ảnh bằng model trả lời hiện tại hoặc model riêng. Tin thoại được chuyển thành văn bản trước: mặc định dùng Whisper trên máy/dịch vụ STT local đã cấu hình, không gửi audio cho model chat. Có thể chọn dịch vụ phiên âm riêng (`/audio/transcriptions`) với model Whisper/transcription; cloud chỉ dùng khi bạn chọn và đã cho phép provider đó. Tệp tối đa 20 MB; nguồn lấy từ DOM/session Messenger của đúng tài khoản, không gửi URL ký số/cookie Facebook cho AI. Kết quả phân tích được lưu trong vault để không đọc lại mỗi lần tạo nháp. Tệp chưa tải/đọc được làm hội thoại chờ kiểm tra; bấm **Đọc lại tệp** sau khi xử lý lỗi.
- Bài đo tốc độ gõ tiếng Việt đếm ký tự hiển thị, bắt đầu từ ký tự đầu và kết thúc khi gõ đúng đoạn mẫu; không nhận paste/drop. Bấm **Dùng tốc độ này**, rồi **Lưu thiết lập trả lời**. Delay tùy chọn = thời gian suy nghĩ + số ký tự × 60.000 / ký tự mỗi phút, có giới hạn tối đa; mặc định tắt. Tin tự động chờ bằng timer riêng, không giữ vòng quét. Soạn tin, có tin mới hoặc pause hủy thời gian chờ; trước khi gửi vẫn kiểm tra thread/context. Gửi thủ công gửi ngay.

Instructions được dựng từ cấu hình và phong cách đã lưu; summary/media/style được dùng lại thay vì nạp toàn bộ lịch sử. OpenAI gửi `prompt_cache_key`, Anthropic đặt cache trên system prompt. Gemini dùng implicit cache hoặc thử tạo handle cho instructions dài từ 12.000 ký tự (TTL 10 phút), đổi instructions/model/provider tạo cache mới; khi không hỗ trợ hoặc cache hết hạn, gửi lại instructions. Không cam kết cache hit hoặc loại bỏ token đầu vào trên mọi model. Xem tài liệu chính thức: [OpenAI](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Gemini](https://ai.google.dev/api/caching).

## Dữ liệu và bảo mật

Vault ở thư mục `secure` bên trong `app.getPath('userData')`. Nội dung mã hóa AES-256-GCM; khóa ngẫu nhiên được bảo vệ bằng Electron safeStorage (Keychain/DPAPI). Không fallback plaintext. Nếu mất khóa/corrupt, app báo lỗi và giữ file; không reset âm thầm. Đây là bảo vệ dữ liệu trên đĩa, không chống malware chạy cùng quyền user hay truy cập bộ nhớ tiến trình.

Browser session không persist và HTTP cache tắt. Cookies được snapshot mã hóa; localStorage không lưu bền. Vì vậy Facebook có thể cần đăng nhập/PIN/E2EE lại sau restart. Không dùng crash upload/telemetry hoặc server của ứng dụng. Messenger vẫn kết nối Facebook để đọc/gửi tin; AI local server phải được cấu hình không forward cloud nếu bạn muốn giữ ngữ cảnh trên máy. Khi bật cloud riêng cho một provider, ngữ cảnh cần thiết được gửi trực tiếp tới endpoint bạn cấu hình (không đi qua server Master Chat); credentials Facebook/cookies không gửi cho AI.

Khi gửi lỗi/timeout sau khi bắt đầu thao tác, trạng thái là **uncertain**, không tự retry. Kiểm tra trình duyệt rồi chọn “Tôi xác nhận đã gửi” hoặc “Chưa gửi, bỏ nháp”. Cả hai dừng engine và loại trigger khỏi hàng đợi; không tự gửi lại.

## Trạng thái chính xác

- Đã có UI desktop, encrypted vault, tabs/popout, multi-provider AI/task model selection, raw history, incremental summary, local keyword knowledge, baseline/cutoff/dedupe/pause, reply/proactive drafts và outbox guards.
- Inbox discovery, DOM MutationObserver làm dấu hiệu thay đổi, polling dự phòng, cuộn có giới hạn và tải ngữ cảnh đã nối với engine. Requests/spam/archive chưa được quét; không bảo đảm bao phủ mọi hộp thư.
- DOM thật đã khảo sát qua DevTools UI, không dùng endpoint Facebook nội bộ hoặc sao chép cookie Chrome. Giao diện khảo sát không có ID message nền tảng: bộ đọc dùng fingerprint nội dung/hướng/thời gian; tin trùng hoàn toàn trong cùng phút bị chặn. Nhãn thứ/ngày không có năm rõ ràng chỉ giữ raw, không suy đoán timestamp. Thay đổi nhãn qua ngày, edit/delete, các dạng media chưa nhận diện và bản dịch khác còn cần reconciliation; chưa coi adapter này là bảo đảm vận hành lâu dài.
- Luồng đọc/gửi, cutoff, pause và discovery đã kiểm thử bằng DOM/transport mô phỏng. Chưa chứng minh tự trả lời thật với model thật và incoming thử trên tài khoản app.
- Còn thiếu vector embeddings local/SQLCipher, reconciliation edit/delete/media đầy đủ, scheduler proactive, chính sách tri thức riêng theo đối tượng, xóa tài khoản và retention/export; xem các giai đoạn trong kế hoạch.

Chi tiết: [cơ chế hoạt động và phát hiện tin mới](docs/CO-CHE-HOAT-DONG.md), [kế hoạch](docs/PLAN.md), [khảo sát trình duyệt thật](docs/BROWSER-RESEARCH.md), [bàn giao triển khai](docs/IMPLEMENTATION.md), [nâng cấp Messenger](docs/MESSENGER-UPGRADE.md).

## Phiên âm local

Bản macOS ARM64 trong `dist/knowledge-import/mac-arm64/Master Chat.app` kèm Whisper.cpp CPU và model **base đa ngôn ngữ**. FFmpeg đã được phát hiện trên máy hiện tại; máy khác cần cài FFmpeg hoặc đặt đường dẫn. Trong **Cấu hình AI → Phong cách & nhịp trả lời → Phiên âm trước khi trả lời**, giữ **Trên máy (Whisper)** để audio được xử lý local. Bản chép được lưu trong vault và hiển thị cùng tin nhắn; model trả lời chỉ nhận văn bản. Thiếu công cụ/model hoặc phiên âm lỗi thì chờ kiểm tra, không chuyển audio sang Gemini/OpenAI chat.

Luồng local: audio Messenger → FFmpeg mono WAV 16 kHz → Whisper → văn bản → ngữ cảnh trả lời. Tệp tạm nằm trong thư mục riêng 0700, audio/WAV 0600, xóa sau thành công/lỗi; crash cưỡng bức có thể để lại tệp tạm. Không ghi audio vào vault. Giới hạn 20 MB đầu vào, 10 phút phiên âm local, tối đa 20.000 ký tự bản chép; giữ ngôn ngữ gốc, không bật dịch sang tiếng Anh. Ngôn ngữ để trống là tự nhận diện; có thể đặt `vi` cho tiếng Việt.

Để build runtime trên macOS/Linux, cài CMake/compiler rồi chạy `npm run setup:speech` (hoặc đặt `MASTER_CHAT_CMAKE` trỏ tới CMake). Script tải source Whisper v1.9.4 và model base, đối chiếu SHA256, đặt runtime trong `runtime/speech/<platform>-<arch>` được bỏ qua bởi Git. Build macOS đóng gói thư mục runtime tương ứng vào `Contents/Resources/speech`; Windows cần tự build/chọn whisper-cli.exe và FFmpeg, chưa kiểm chứng. Có thể thay model đa ngôn ngữ lớn hơn qua đường dẫn tùy chọn để thử cải thiện độ chính xác; không dùng model `.en` cho tiếng Việt. Xem [Whisper.cpp](https://github.com/ggml-org/whisper.cpp) và [model chính thức](https://huggingface.co/ggerganov/whisper.cpp).
