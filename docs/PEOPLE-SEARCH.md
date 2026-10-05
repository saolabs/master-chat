# Tìm người trên desktop — 06/10/2026

Bộ lập truy vấn được chuyển từ `seo-expert/src/lib/seo-tools/deep-search/{input,query-planner,name-variants,context-query-variants,social-platforms}.ts` vào `src/core/people-planner/`. Giữ planner person, reconcile deterministic và query coverage; thay adapter server bằng Chromium tương tác của Electron. Không đưa tenant/Postgres/BullMQ vào Master Chat.

## Đầu vào và cách tìm

Họ tên, họ/tên riêng, email, điện thoại + mã quốc gia, username, URL hồ sơ, tổ chức, tối đa 10 tiêu chí bổ sung có nhãn/giá trị (trường học, tỉnh/thành hoặc tùy ý), ngôn ngữ báo cáo. Tên đầy đủ mâu thuẫn với họ/tên bị chặn trước khi chạy. Điện thoại kiểm tra và chuẩn hóa E164 bằng `libphonenumber-js`, với VN mặc định. Mã quốc gia khác được hỗ trợ, không suy đoán từ chuỗi chữ số.

Planner giữ các cách tìm của bản gốc: đầu mối liên hệ độc lập; tên + từng tiêu chí; truy vấn từng nền tảng; tên đảo thứ tự/không dấu/username; rút nhãn trường học người dùng đã nhập để tìm nguồn. Mọi tiêu chí gốc vẫn giữ nguyên khi đối chiếu. Tên có dấu khác nhau (Doãn/Đoan) không bị coi là một; dạng không dấu là đầu mối khám phá.

| Mức | Truy vấn web / công cụ | Kết quả web / truy vấn | Nguồn được đọc |
| --- | ---: | ---: | ---: |
| Nhanh | 6 | 5 | 12 |
| Tiêu chuẩn | 11 | 8 | 40 |
| Mở rộng | 15 | 10 | 80 |
| Toàn diện | 42 | 50 | 500 |

Chọn Google/Bing/DuckDuckGo và sáu nền tảng. Có lựa chọn riêng **Tìm trực tiếp**: mở giao diện People/tài khoản của Facebook, Instagram, LinkedIn, X, YouTube, TikTok; đọc các liên kết tài khoản đang hiển thị, loại liên kết điều hướng. Facebook dùng `/search/people/`. Bộ đọc trực tiếp cuộn tối đa bốn lần, giữ tối đa 24 hoặc 50 đầu mối tùy mức. Với chỉ họ + tên, tìm cả thứ tự đảo/không dấu và tối đa hai tên đệm **thực sự xuất hiện** trong kết quả trực tiếp. Hai tên quan sát này có thể thêm lượt ngoài ngân sách truy vấn ban đầu.

Toàn diện có thể theo link Next thực tế trên SERP, tối đa năm trang mỗi truy vấn, kiểm tra host/path/q; không tạo URL trang tiếp theo bằng phỏng đoán. Các kết quả trên trang và bố cục thực tế có thể thấp hơn hạn mức. Không coi một checkbox nền tảng hay một SERP trống là đã tìm hết mạng xã hội.

URL người dùng cung cấp được ưu tiên đọc. Nguồn công khai có H1/OG metadata, `sameAs`, `rel=me` và các liên kết tài khoản/hoạt động hiển thị được lưu. Với tên chủ thể phù hợp, theo tối đa tám link/trang trong hai vòng, trong ngân sách tổng. Các liên kết trang tự công bố là tín hiệu khám phá, chưa xác minh danh tính. URL root tài khoản được đọc bổ sung khi URL bài đăng xác định rõ tài khoản; không suy ra chủ thể của YouTube watch hoặc Facebook photo.php.

## Hồ sơ, báo cáo và thư viện

Nguồn được tập hợp khi URL xác định cùng tài khoản trong cùng namespace nền tảng. Khác nền tảng không tự nối vì trùng tên, username, email hoặc điện thoại. Đối chiếu **Cùng người / Khác người / Chưa rõ** có lý do được lưu; quyết định khác/chưa rõ ngăn cầu nối bắc cầu. Đối chiếu thủ công cập nhật nhóm hiện tại; các bản hồ sơ đã lưu là snapshot độc lập.

Đối chiếu tiêu chí chỉ dựa trên URL nguồn/nội dung đã đọc, không nâng SERP snippet thành bằng chứng. Confidence về tiêu chí tách với identityState (account_only / reviewed_link / unresolved). Khớp văn bản không chứng minh danh tính ngoài đời.

AI dùng model **Tri thức** hoặc model chung đã cấu hình, cùng permission/key rotation/fallback hiện có. Có thể tự dựng báo cáo khi đọc xong, đọc một hồ sơ hoặc dựng tất cả. Mỗi nguồn tối đa 40 dữ kiện thuộc: nghề nghiệp, tổ chức, học tập, việc làm, thành tựu, sự kiện/quan hệ tổ chức nghề nghiệp, nội dung chuyên môn chia sẻ, hoạt động và địa điểm công khai. Không suy luận thuộc tính nhạy cảm hoặc đời tư. Nguồn là dữ liệu không tin cậy.

Mỗi dữ kiện phải có đoạn dẫn nguyên văn, offsets, evidence ID, model và hash source. Gate kiểm tra tên chủ thể; tự khai chỉ chấp nhận nếu metadata chủ tài khoản phù hợp. Thời gian phải xuất hiện nguyên văn trong đoạn dẫn. Loại đoạn dẫn không tồn tại, chủ thể khác và thời gian bịa. Đây là kiểm tra văn bản, chưa chứng minh mọi diễn giải của AI đúng về ngữ nghĩa; người dùng cần kiểm tra trích dẫn. Timeline xếp năm được công bố rồi dữ kiện chưa rõ thời gian, không đoán ngày.

**Lưu hồ sơ** giữ tối đa 10 phiên bản trên mỗi hồ sơ trong vault, cùng nguồn và phân tích liên quan; xóa lượt tìm không xóa hồ sơ đã lưu. **Nghiên cứu sâu hơn** tạo lượt mới neo URL hồ sơ, giữ tiêu chí cũ và thêm truy vấn theo hướng người dùng chọn; focus là hướng tìm, không là dữ kiện về người. Dùng được cả từ thư viện. Không tự đưa kết quả vào tri thức hoặc prompt trả lời Messenger.

**Xuất JSON / CSV** xuất báo cáo, tiêu chí thiếu, nguồn, trích dẫn, offsets, thời gian và quyết định đối chiếu. Không xuất accountId, cookies, queries hoặc toàn bộ source snapshot. CSV escape công thức. File xuất là văn bản rõ ở vị trí người dùng chọn.

## Trình duyệt, lưu bền và kiểm chứng

Cửa sổ Chromium riêng không Node/preload, chặn popup/download/quyền thiết bị; chỉ URL HTTPS công khai, không credential/IP literal/tên LAN rõ ràng. Phiên nghiên cứu cookies trong bộ nhớ hoặc phiên Facebook của tài khoản trong app. Không giải CAPTCHA tự động. CAPTCHA/consent/login hoặc DOM chưa hỗ trợ làm lượt đọc chờ; xử lý trong trình duyệt rồi **Tiếp tục**. Đóng cửa sổ/restart giữ cursor và không tự retry. **Bỏ qua** ghi lỗi thiếu coverage. Hủy loại kết quả muộn và hủy AI đang tự dựng báo cáo. Source text tối đa 60.000 ký tự/URL, lưu một lần, mã hóa trong vault. Lịch sử giữ 20 lượt; thư viện riêng vẫn giữ bản đã lưu.

`npm test`, `npm run typecheck`, `npm run build`; `npm run test:people-browser` kiểm tra Chromium bằng toàn bộ HTTPS intercept giả: CAPTCHA → tiếp tục cùng truy vấn → source → Facebook People → metadata/link. Không dùng người thật, cookie thật hoặc tài khoản thật trong fixture. Tests bao gồm planner gốc, tên/điện thoại, khác người/bắc cầu, offsets/time, pagination, cancellation, vault/library và UI nâng cao mặc định thu gọn.

Các adapter API Brave/Exa/Tavily, academic/entity APIs, Maigret, OAuth/connector và hạ tầng knowledge server của seo-expert chưa được chuyển sang. Direct adapters phụ thuộc DOM và quyền truy cập của tài khoản trên nền tảng; fixture chưa chứng minh bố cục live của mọi nền tảng hoạt động. Trang không đọc được hiển thị trạng thái chờ thay vì ghi nhận kết quả thành công.
