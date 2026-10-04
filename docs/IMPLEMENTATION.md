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

## Cập nhật hội thoại đang xem và ưu tiên trả lời — 04/10/2026

Hội thoại đang xem có WebContents riêng, giữ nguyên thread và đọc tin mới khoảng mỗi giây; không cuộn lịch sử hay chuyển qua các thread khác. Luồng này chạy cả khi tự trả lời tạm dừng, không gọi AI hoặc gửi tin khi đang tạm dừng. Snapshot hiển thị trạng thái kết nối/cập nhật/bị chặn. Giao diện giữ vị trí khi người dùng đang xem tin cũ, tự cuộn theo tin mới khi ở cuối lịch sử. Lý do tạm dừng được lưu trong trạng thái phiên; cạnh checkbox có nút Tiếp tục nếu quyền tự trả lời đã bật nhưng engine đang dừng.

Khi engine chạy, vòng quét có nhịp 2 giây và tối đa 4 hội thoại mỗi lượt: thread đang xem, thread có tin chờ hoặc thay đổi trong inbox, và một thread luân phiên. Không còn bắt thread đang xem đợi hết toàn bộ danh sách 22 hội thoại. Lượt trước chưa xong thì không tạo lượt quét chồng; tải trang và thời gian AI/mạng có thể kéo dài hơn nhịp đặt. Tin mới cập nhật cả khi AI đang soạn và làm bản nháp cũ mất hiệu lực trước khi gửi. Các guard cutoff, baseline, định danh, người nhận, composer thủ công và gửi không chắc chắn vẫn áp dụng.

78 kiểm thử Node, typecheck, format check, production build và Chromium fixture đạt. Có kiểm thử cập nhật khi tạm dừng không gọi AI/gửi, tin đến giữa lúc AI soạn, phân lô/luân phiên 22 thread, đổi thread khi đọc cũ chưa xong; fixture Chromium chứng minh live view giữ thread dù worker chuyển thread khác. Giao diện thử bằng dữ liệu giả ở 1280 và 1000 px. Chưa thử gửi tin thật cho người dùng Messenger trong lượt sửa này.

## Nhận diện hội thoại khi Messenger thiếu aria-current — 04/10/2026

Quan sát cửa sổ Master Chat đang chạy qua accessibility: Messenger đã hiển thị tin mới lúc 16:27/16:30 trong Roy X8Gaming, trong khi bộ đọc báo selected thread không có. Đây là lỗi xác nhận DOM trong app; chưa có bằng chứng lỗi HTTP/socket. Bản đang chạy là `dist/mac-arm64/Master Chat.app`, chưa phải bản live-updates vừa đóng gói.

Bộ đọc trước đây chỉ dùng a[aria-current=page]. Nay hỗ trợ aria-current=true và aria-selected=true trên link/row; nếu không có dấu chọn, phải đồng thời khớp URL, tên duy nhất trong inbox, nhãn vùng Cuộc trò chuyện với/Conversation with và tên người nhận của composer trong chính vùng đó. Không dùng URL đơn lẻ làm bằng chứng. Nếu dấu chọn tường minh xung đột, tên bị trùng, link ngoài Facebook hoặc vùng người nhận còn cũ, fallback không cho phép gửi. Read, preflight và xác nhận echo dùng chung kết quả nhận diện.

81 kiểm thử Node đạt, cùng typecheck, format check, production build và Chromium fixture. Fixture Chromium kiểm tra đọc/gửi/echo không có aria-current, live view nhận tin mới và chặn vùng người nhận sai. Quan sát tài khoản thật chỉ đọc giao diện; không bấm gửi hoặc bật tự trả lời trong lượt này. Chưa xác nhận gửi Messenger thật sau bản sửa.

## Chạy bản mới và kiểm chứng thực tế — 04/10/2026

Theo yêu cầu trực tiếp, đã thoát hai bản cũ (dist/mac-arm64 và dist/compact-ui), build lại production, đóng gói dist/verified-live/mac-arm64/Master Chat.app và chạy đúng binary đó. Người dùng đã lưu PIN local trong giao diện; chỉ kiểm tra hasRecoveryPin/trạng thái tự nhập, không đọc mã. Roy X8Gaming đồng bộ đủ 9 tin, gồm các incoming 16:27, 16:30, 16:35. Đối chiếu lịch sử Messenger không thấy bản nháp cũ uncertain; ghi nhận Chưa gửi, bỏ nháp qua UI để không gửi lại bản nháp đó.

Đã bật engine, theo dõi và đối chiếu trang Messenger với dữ liệu local; chưa thấy tin thử mới sau 16:35 trong khoảng quan sát. Tạo bản nháp bằng lịch sử thật theo quyền cloud đã cấu hình thất bại lặp lại với HTTP 503. Test provider bằng prompt ngắn thành công cùng model gemini-3.8-flash, nên không kết luận mất toàn bộ kết nối Gemini hay lỗi socket Messenger. Bổ sung nhãn tác vụ/model trong lỗi localChat, chạy lại 81 kiểm thử/typecheck/build/format check và mở lại bản đóng gói; UI xác nhận lỗi ở Trả lời · gemini-3.8-flash: Provider trả HTTP 503. Không thay model hoặc key.

Bản cuối được để mở tại hội thoại Roy, engine Đang theo dõi, checkbox tự trả lời bật. Chưa chứng minh được một lượt incoming mới → tự trả lời → outgoing echo trên bản cuối. Quét nền vẫn có lỗi tên composer không khớp ở một số hội thoại khác; không bỏ guard để ép gửi. Có theo dõi tiếp hữu hạn để chờ tin thử của người dùng, chỉ báo thay đổi/kết quả cần xử lý.

## Ô soạn chat, bản nháp AI và quyền tự trả lời toàn tài khoản — 04/10/2026

Bổ sung ô nội dung và nút Gửi cố định dưới lịch sử; Enter gửi, Shift+Enter xuống dòng, không gửi trong lúc IME đang nhập. Gửi thủ công không cần resume hoặc model AI. Nội dung giữ riêng theo hội thoại trong phiên renderer, đổi hội thoại không mất hoặc lẫn tin. Bản nháp AI được đưa vào cùng ô soạn; mặc định người dùng sửa/gửi, có tùy chọn gửi ngay sau khi tạo. Sidebar dùng để xem/đưa nháp vào ô soạn và giải quyết uncertain. Ở cửa sổ nhỏ, sidebar không che ô soạn và nút gửi.

Engine nhận trạng thái đang soạn, chặn auto trên đúng hội thoại đó, kể cả AI đã bắt đầu sinh phản hồi; các hội thoại chưa mở khác vẫn được xử lý. Nháp thủ công đang chờ không bị tick thay thế. Gửi tay ghi outbox vào vault trước thao tác, dùng chung guard người nhận/thread/composer/ID cuối/echo và uncertain không retry. Tin mới làm nháp stale thì cần xem lại, tạo lại hoặc chủ động dùng nội dung như tin mới. Xóa nội dung loại nháp chưa gửi khỏi trạng thái chờ.

Trong Quản lý inbox, Bật tự trả lời toàn bộ/Tắt toàn bộ áp dụng theo account cho cả thread hiện có và quyền discovery về sau; không tự resume. Sau khi bật quyền, người dùng bấm Tiếp tục để chạy nền.

92 kiểm thử Node/React đạt; typecheck, build, format check và Chromium Messenger fixture đạt. Fixture giao diện dùng dữ liệu giả xác nhận giữ tin khi đổi A → B → A, giữ đúng trạng thái đang soạn, AI điền vào ô chat và bố cục 1280/1000 px. Không gửi Facebook thật hoặc thay đổi quyền auto trong vault tài khoản thật để kiểm thử tính năng này.

## Media, phong cách và nhịp trả lời — 04/10/2026

- Thêm metadata ảnh/audio ở bộ đọc semantic, tìm nguồn theo đúng message/thread, tải HTTPS qua session riêng hoặc blob trong WebContents sở hữu nó. Allowlist Facebook/CDN, MIME và giới hạn stream 20 MB; source ký số được bỏ khỏi snapshot. Tự đọc trước generate, lưu analysis/error theo attachment ID; lỗi không bị gọi lặp mỗi tick, có retry thủ công. Summary/history dùng nội dung đã phân tích, batch chưa đọc media không được tóm tắt.
- AI transport hỗ trợ ảnh native OpenAI-compatible/Anthropic/Gemini, audio inline Gemini và WAV/MP3 OpenAI chat, multipart `/audio/transcriptions` cho model Whisper/transcription riêng. Model/endpoint/cloud permission vẫn được kiểm tra; không tự fallback sang provider khác.
- Cấu hình tùy chọn về bản thân/tính cách/instructions chung, phong cách từng hội thoại và bật/tắt tự học riêng. Học từ 5–50 outgoing của chủ tài khoản; loại tin AI đã gửi; thêm 5 mẫu mới mới học lại. Kết quả học lưu vault; thiếu mẫu/lỗi dùng phong cách chung.
- Bài đo tốc độ gõ bằng grapheme NFC, thời gian đo hợp lệ và kết quả CPM/WPM. Delay tự động theo độ dài và CPM, có thinking time/ceiling; mặc định tắt. Timer mỗi hội thoại để không chặn các thread khác; pause/composing/incoming hủy, gửi vẫn qua preflight/echo/uncertain. Restart bỏ thời điểm chờ và luôn mở paused.
- Instructions ổn định, OpenAI cache key, Anthropic system cache control và Gemini cachedContents cho prefix dài, TTL/cooldown/fallback. Stateless API vẫn nhận system prompt khi không có cache; không quảng cáo zero-input-token.
- UI mới trong Cấu hình AI → Phong cách & nhịp trả lời; hội thoại có phần riêng trong Trợ lý AI, nội dung phân tích tệp và nút đọc lại.
- Kiểm chứng dùng fetch/DOM/vault giả lập và Chromium fixture cục bộ; không gửi media/history thật ra provider hoặc nhắn người thật trong lượt này. Khả năng model thật, các dạng media Messenger khác, Windows và ký số cần nghiệm thu riêng.

- Kết quả cuối: 114/114 unit/UI/transport/engine tests qua; typecheck, format và production build qua. Chromium fixture đọc HTTPS image và page-owned audio blob thành công; fixture React kiểm tra calibration, lưu cấu hình và composer ở 1280/1000 px. Bản macOS ARM64 không ký số: `dist/media-style/mac-arm64/Master Chat.app`; cần thoát bản đang chạy rồi mở bản này để dùng thay đổi.

## Âm thanh → văn bản trước khi gọi model trả lời — 04/10/2026

- Thay nhánh audio multimodal bằng bộ phiên âm chuyên biệt; `providerChat` từ chối audio ở mọi giao thức. `analyzeMedia` chuyển audio sang `transcribeAudio` trước khi resolve model reply, nên không cần model chat hỗ trợ audio.
- Mặc định local: tự dùng dịch vụ Whisper loopback đã cấu hình, hoặc Whisper CLI/model đi kèm/trên máy. FFmpeg giải mã mono PCM WAV 16 kHz, Whisper giữ ngôn ngữ gốc, không dịch. Lựa chọn provider chỉ chấp nhận model Whisper/transcription và dùng `/audio/transcriptions`; không tự chọn cloud hoặc fallback sang chat.
- Bộ xử lý chạy không qua shell, nhận argument riêng, giới hạn decode/network/child timeouts và độ dài. Tệp tạm riêng được xóa trong finally; pause abort child. Runtime/mac model base đa ngôn ngữ được chuẩn bị trong thư mục ignored, có script build lại và kiểm tra SHA256; runtime mac được đóng gói qua extraResources. FFmpeg hiện có trên máy; chưa bundle FFmpeg hoặc kiểm chứng Windows.
- UI phân biệt model đọc ảnh với cách phiên âm, ngôn ngữ auto/vi/en và đường dẫn local tùy chọn. Tin đã có bản chép không bị upload/phiên âm lại ở mỗi câu trả lời.
- Kiểm chứng cuối: 124/124 kiểm thử qua, không skip; typecheck, format check, build và diff check qua. Chạy FFmpeg + Whisper thật qua `transcribeAudio` với fetch bị chặn: mẫu tiếng Anh JFK phục hồi nội dung trong khoảng 1 giây; mẫu tiếng Việt tổng hợp “Xin chào, hẹn bạn lúc mười giờ sáng mai.” được chép thành “Xin chào, hẹn bản lúc 10 giờ sáng mai.”, giữ ý nhưng còn lỗi một từ. Đây là kiểm tra luồng local trên mẫu ngắn, chưa đại diện chất lượng tin thoại Messenger thực tế.
- Bản mới `dist/speech-text/mac-arm64/Master Chat.app` có CLI static CPU và model base đa ngôn ngữ; đã kiểm tra SHA256 model, quyền thực thi và audio guard trong app.asar. macOS ARM64 chưa ký số; FFmpeg trên máy hiện tại được tìm tự động. Không gửi tin thật, không upload audio thật và không gọi model trả lời cloud trong lượt này.

## Hồ sơ từng người, ngữ cảnh quan hệ và kiểm tra độ tự nhiên — 04/10/2026

- Thay học phong cách từ 5 mẫu bằng contactProfile từ ít nhất 50 tin có nội dung của hai phía. Phong cách chỉ dẫn outgoing của chủ tài khoản, loại tin AI/system. Đọc toàn bộ lịch sử hiện có theo phần 100 tin/32.000 ký tự, giới hạn 4.000 ký tự/tin. Lưu relationship/address/style/facts/cautions cùng dẫn chứng, source hash và số mẫu; thêm 10 tin mới thì cập nhật, tin dẫn chứng bị sửa thì bỏ hồ sơ cũ/dựng lại. Lỗi được cache theo lịch sử, có nút Dựng lại hồ sơ. Sync/generate/vòng quét dựng hồ sơ khi đủ dữ liệu và có model; thiếu mẫu dùng phong cách chung.
- Mỗi hội thoại có relationshipContext và conversationDirection độc lập, đều tùy chọn. Sidebar có nhãn/mô tả, nút lưu và xem tin dẫn chứng. Prompt ưu tiên chủ đề/ý định tin mới, không gán ẩn ý hoặc kéo chuyện cũ vào câu mới; không tự nhận đã debug/nghiên cứu/làm việc chưa xác nhận. Định hướng dài hạn không bắt buộc xuất hiện trong mỗi tin và không cho phép gây áp lực/chẩn đoán từ suy đoán.
- Reviewer dùng model khác qua localChat transport hiện có. Tự chọn chỉ trong provider reply; có chọn riêng hoặc tắt. Không có model khác thì ghi skipped, khi chủ động bật mà chưa có model thì unavailable. Validate approve/revise/hold; sửa rồi kiểm tra lại tối đa một lần, lưu bản trước sửa và reviewedText. Hold/lỗi/JSON sai giữ draft, chặn schedule/send auto; gửi thủ công vẫn do người dùng quyết định. Pause/tin mới trong khi checker chạy không lưu nháp cũ.
- Bản chép nằm trong attachments.analysis thuộc lịch sử tin gốc, được giữ khi DOM refresh và mở lại vault. Thêm nhãn Bản chép âm thanh · đã lưu, tìm trong toàn bộ lịch sử local và Hiện thêm tin đã lưu. Nạp thêm lịch sử tăng cửa sổ đọc tối đa 500 tin/lần tới trần 5.000 tin, có giới hạn cuộn; sửa giới hạn 59 trong native DOM bằng historyLimit. Import không tạo trigger trả lời và chỉ cuộn worker. Profile DOM tùy chỉnh cần tự cuộn trong browser; nạp sâu tích hợp dùng native adapter.
- 137/137 unit/UI/engine/transport/vault tests qua, không skip; typecheck, format, production build và diff check qua. Chromium fixture xác nhận giữ 120 tin qua nạp sâu, pause signal và các guard/send/echo/media cũ. Fixture giao diện xác nhận tìm bản chép ngoài 50 tin, nhập/lưu hai ngữ cảnh riêng, calibration và composer ở 1280/1000 px; đã xem ảnh chụp để kiểm tra bố cục.
- Bản macOS ARM64: dist/contact-profiles/mac-arm64/Master Chat.app, chưa ký số, kèm Whisper/model. Không gửi tin thật, không thay dữ liệu tài khoản thật và không gọi model cloud trong lượt này. Test reviewer/profile dùng model giả lập, nên chưa nghiệm thu chất lượng ngôn ngữ của model thật; khả năng nạp sâu trên mọi bố cục Messenger và Windows vẫn cần đối chiếu thực tế.

## Form sửa nằm trong card của tài khoản/provider — 04/10/2026

- Tách AccountSettings khỏi main: danh sách tài khoản là giao diện mặc định, bấm Thêm tài khoản mới mở form tạo; khi chưa có tài khoản, form thêm mở sẵn. Sửa mở form ngay bên trong card tương ứng, có tên tài khoản, nhãn Đang chỉnh sửa, Lưu thay đổi và Hủy. Chọn sửa đóng form thêm; lưu lỗi giữ nguyên nội dung/ID, Hủy không gọi backend. Password/PIN không được đưa vào form từ snapshot.
- ProviderEditor sửa nằm trong card provider, card mở rộng hết hàng; form tạo chỉ hiện khi bấm Thêm provider. Giữ tên/ID provider rõ trong chế độ sửa. Sau Lưu & tải model của provider mới, giao diện chuyển vào card đã tạo; không tiếp tục trình bày form đang thêm mới.
- 140/140 kiểm thử qua, cùng typecheck, format check, production build và diff check. Các kiểm thử bổ sung xác nhận lưu đúng ID, hủy không gửi lệnh, dữ liệu không mất khi save lỗi và mode create không có ID tài khoản cũ. Không sửa vault thật để kiểm thử UI.
- Fixture Electron với dữ liệu giả xác nhận form tài khoản nằm trong đúng card, nhãn/nút phân biệt mode, trường bí mật trống, Hủy và Thêm mở đúng form ở chiều rộng 1280/1000 px. Đã kiểm tra ảnh chụp tài khoản/provider; sửa bố cục heading để nhãn Đang chỉnh sửa không chồng tên/endpoint và không tràn ngang.
- Bản macOS ARM64 mới: dist/inline-edit/mac-arm64/Master Chat.app, kèm các tính năng hồ sơ/reviewer/Whisper của bản trước, chưa ký số.

## Kho tri thức và nhập tài liệu - 04/10/2026

- Kho mở bằng danh sách nguồn toàn chiều rộng. Thêm nội dung mở màn nhập riêng, sửa mở ngay trong nguồn tương ứng; không còn form đặt cạnh danh sách. Có tìm kiếm, lọc phạm vi và xác nhận xóa. Provider có khoảng cách riêng giữa tiêu đề, tab, thanh thao tác và danh sách; nhãn/trạng thái và nút không dính nhau.
- Bộ đọc local dùng PDF.js, word-extractor và html-to-text, hỗ trợ PDF, DOC, DOCX, HTML/HTM, TXT và MD/Markdown. Chọn nhiều file qua dialog native hoặc kéo thả; xem và sửa từng nội dung trước khi lưu cả đợt vào vault mã hóa. Không cần Word/LibreOffice trên máy chạy ứng dụng. File lỗi được báo riêng, các file hợp lệ vẫn lưu được; lưu thất bại giữ nội dung để thử lại. Metadata giữ tên file gốc, sửa nguồn giữ đúng ID và phạm vi.
- Giới hạn 30 file/đợt, 20 MB/file, 100 MB đầu vào cả đợt và 100.000 ký tự/nguồn; không cắt nội dung vượt trần. PDF scan chưa có lớp văn bản cần OCR trước, file có mật khẩu cần mở khóa. TXT/Markdown hỗ trợ UTF-8 và UTF-16 có BOM. Truy xuất vẫn dùng từ khóa theo phạm vi tài khoản hiện có.
- 152/152 kiểm thử qua; typecheck, format check, production build và diff check qua. Fixture tự tạo DOC/DOCX/PDF có tiếng Việt kiểm tra trích xuất thật; kiểm thử UI bao gồm nhập nhiều file, kéo thả, sửa nội dung, lưu lỗi và xóa. Playwright kiểm tra Electron và bản đã đóng gói với vault thử riêng: native IPC đọc đủ sáu định dạng, lưu/sửa và bố cục 1360/1050 px. Đã xem ảnh chụp; không dùng tài khoản/vault thật để kiểm thử.
- Bản macOS ARM64: `dist/knowledge-import/mac-arm64/Master Chat.app`, chưa ký số, kèm runtime Whisper/model của bản trước. Thoát bản cũ rồi mở bản này để dùng giao diện và luồng nhập mới; Windows chưa được kiểm chứng.
