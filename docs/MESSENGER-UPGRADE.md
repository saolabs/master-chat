# Nâng cấp Messenger cá nhân — 04/10/2026

## Mục tiêu

Tự khám phá hội thoại từ danh sách inbox, theo dõi tin đến và nối vào engine AI/outbox hiện có. Chỉ Messenger cá nhân. Không dùng Facebook API nội bộ, không sao chép phiên Chrome.

## Thiết kế triển khai

- Bộ đọc Messenger có sẵn, tách khỏi profile generic. Dùng URL thread, DOM công khai/semantic và dữ liệu trên các message node; thiếu ID/hướng/thời gian đáng tin cậy thì báo diagnostics, không tự gửi.
- Monitor inbox riêng theo tài khoản, cùng session RAM/cookie vault với tab người dùng; không cướp tab đang xem. Quan sát revision DOM + polling dự phòng, luôn kiểm tra vùng đầu rồi tiếp tục cuộn xuống qua nhiều vòng có giới hạn và báo coverage partial khi chưa phủ hết.
- Tự thêm hội thoại mới phát hiện, mặc định auto tắt. Có thiết lập tài khoản để thread phát hiện tiếp theo tự bật auto; thread hiện có giữ lựa chọn riêng. Không bật tự gửi khi nâng cấp.
- Baseline lần đầu, watermark tin theo ID; unread chỉ ưu tiên quét, không được dùng để suy đoán tin mới. Tin trước cutoff hoặc thiếu thời gian không kích hoạt AI. Một hội thoại mới xuất hiện sau baseline inbox vẫn phải đọc đủ thời gian và áp dụng cutoff.
- Đồng bộ thủ công hoạt động khi engine paused; pause chặn AI và gửi, không xóa dữ liệu. Engine tự khám phá khi resume.
- Gửi cần kiểm tra thread, account session, latest ID, composer trống, đúng nút gửi và outgoing echo; uncertain không retry. Không dùng nút gửi lượt thích.
- Kiểm thử DOM fixture và integration engine: redirect, nhiều hội thoại/unread cũ, thread mới, burst, pause, duplicate/restart, sender/ID/timestamp thiếu, gửi và echo.

## Nghiệm thu

Build/typecheck/tests; khảo sát DOM thật khi có phiên đăng nhập. Không gọi việc gửi thật thành công nếu chưa có hội thoại thử, model và tin incoming thử. Các giới hạn phát hiện/coverage phải hiển thị trong UI.

## Kết quả triển khai

- Có bộ đọc tích hợp, monitor inbox và worker thread; đồng bộ thủ công khi paused, diagnostics/coverage, chọn auto từng thread và policy thread mới ở UI.
- Guard phiên tài khoản + URL + selected link + nhãn người nhận + latest ID + composer + outgoing echo; uncertain giữ bền và không retry.
- 65 kiểm thử đã qua, gồm discovery nối engine/AI/outbox, pause muộn, cutoff đến phút, NFD, duplicate, DOM drift, nút gửi và cuộn tiếp inbox.
- Facebook DOM khảo sát không có ID message nền tảng: fingerprint là fallback có hạn chế, không cam kết ID lâu dài. Thời gian cũ thiếu ngày rõ ràng chỉ giữ raw. Quét chỉ inbox chính tải được; requests/spam/archive và edit/delete/attachments chưa nghiệm thu.
- Chưa hoàn tất kiểm chứng gửi thật với model và incoming thử trên app; người dùng đã chọn hội thoại thử, cần phiên tài khoản/model sẵn sàng.

Chromium fixture riêng đã qua: inbox/read native, CDP input tạo sự kiện input, click đúng nút và outgoing echo; chặn draft người dùng, lệch selected thread, đổi account session và incoming chen vào sau khi nhập trước click. Chạy lại bằng `npm run test:browser`; toàn bộ trang/tin/cookie ở fixture là giả lập cục bộ, không gửi Facebook thật.

Cutoff thực tế lấy mốc lớn hơn giữa lần bật engine đầu tiên và lần theo dõi inbox đầu tiên của tài khoản. Hai mốc được giữ qua pause/restart. Inbox sâu được phát hiện muộn không được dùng cutoff cũ của tài khoản khác.
