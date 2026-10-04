# Khảo sát trực tiếp trình duyệt — 03/10/2026

Được người dùng cho phép đọc hai tab Chrome đã đăng nhập. Chỉ xem UI, mở một tab khảo sát tạm và đóng sau khi xong; không gửi, sửa, xóa tin hay đổi trạng thái thư mục. Không lưu tên người/ID thật/nội dung hội thoại vào repo.

## Kết quả quan sát

| Nội dung | Cá nhân | Fanpage |
|---|---|---|
| URL thread | `/messages/t/<id>` và `/messages/e2ee/t/<id>` cùng xuất hiện | `asset_id`, `selected_item_id`, `thread_type=FB_MESSAGE`, `mailbox_id` |
| Mở URL gốc trong tab mới | Redirect `/messages/e2ee/t/<id>/#` vào mục đầu danh sách trong lượt thử | Thêm `asset_id` + `ir_qe_exposed`; UI hiện hội thoại nhưng URL **không** có selected_item_id |
| Inbox controls | Tất cả, Chưa đọc, Nhóm, Xem thêm; list dạng bảng/row/link | Chưa đọc, Ưu tiên, Tin trả lời quảng cáo, Trao đổi thêm, Bộ lọc |
| Thư mục | Chưa khảo sát menu requests/archive | Bộ lọc có Xong và Spam |
| Composer | textbox có tên `Viết cho <người>`; không được nhầm nút Gửi lượt thích | textbox placeholder `Trả lời trong Messenger…`; cũng có Gửi lượt thích |
| Tin hiển thị | accessibility label có người gửi + HH:mm + nội dung; có reply quote, reaction, attachment/system events | Tin có các mốc nhóm như HH:mm + thứ; không nhất thiết một timestamp/ID mỗi bubble |
| Loading | Có placeholders `Đang tải...`, `Đang tải tin nhắn` | Chỉ thấy các thread trong vùng đang hiển thị, chưa chứng minh quét đủ |

## Những điều chưa chứng minh

- Không có tin mới thật được tạo trong lượt khảo sát: chưa thể kết luận tất cả loại tin incoming đều nổi lên đầu, hoặc UI đang mở tự cập nhật ra sao.
- Không lấy được raw DOM thông qua Chrome hiện có: môi trường hiện chỉ cấp native accessibility, không có Chrome DOM connector. Chưa xác nhận CSS selector, message platform ID, timestamp đầy đủ, asset identity trong DOM, paging/virtualization, gửi + outgoing echo.
- URL business gốc không có selected_item_id chứng minh URL **không đủ** để định danh thread đang hiện. Không suy ra ID từ profile link hoặc tên hiển thị.
- Số trên title/tab có thể là tổng notification, không dùng làm message event.

## Quyết định áp dụng

1. Bắt buộc thread identity trong vùng messages/composer và account/page identity trước đọc/gửi. URL chỉ là một kiểm tra bổ sung; thiếu ID -> dừng, báo diagnostics.
2. Dedupe theo ID, timestamp đáng tin cậy + baseline/cutoff; không dùng unread hay rank để xác định quyền gửi.
3. Inbox monitor quét nhiều thread; không chỉ selected thread. Luôn báo coverage partial khi chưa xử lý pagination.
4. Tách outgoing/incoming/system; không tóm tắt reaction, read receipt hay quote thành một tin mới trùng.
5. Profile DOM mặc định chưa hiệu chỉnh; engine có thể test với fixture local nhưng không tuyên bố Facebook auto-send hoạt động.

## Bổ sung khảo sát DOM — 04/10/2026, chỉ Messenger cá nhân

Các kết luận thiếu raw DOM ở trên thuộc lượt khảo sát 03/10. Lượt này đã đọc DOM công khai bằng JavaScript chỉ đọc qua DevTools UI của tab Chrome khảo sát; không truy cập React stores, token, cookie hoặc endpoint nội bộ.

- Root Messenger redirect vào cuộc trò chuyện mới nhất trong phiên khảo sát; không chứng minh mọi incoming đều nổi lên đầu.
- Inbox: grid aria-label “Đoạn chat” chứa row và anchor `/messages/t/<id>/`, `/messages/e2ee/t/<id>/`; tên lấy từ span dir=auto. Link đang chọn có aria-current=page. Nhãn tiếng Việt dùng dạng NFD nên cần chuẩn hóa NFC/strip dấu đúng cả Đ hoa.
- Message: role=article chứa role=button có aria-label “Nhập, Tin nhắn do <người> gửi lúc <thời gian>: <nội dung>”. Không tìm thấy data-message-id, time datetime, data-utime hoặc timestamp đầy đủ trong mẫu đang hiện. Mẫu hôm nay dùng HH:mm; mẫu cũ dùng thứ + giờ. Hover mô phỏng chưa thấy tooltip đầy đủ.
- Composer: contenteditable=true, role=textbox, aria-label “Viết cho <người>”. Nút gửi nhãn “Nhấn Enter để gửi”; không được dùng “Gửi lượt thích”.
- Bộ đọc mới dùng URL + selected link + nhãn người nhận để đợi DOM chuyển đúng thread, rồi kiểm tra latest/composer trước gửi. Identity tài khoản lấy từ session riêng của ứng dụng; không nhập session Chrome.

Chưa có lượt end-to-end gửi thật bằng adapter trong tài khoản app; dữ liệu nhắn tin thật không lưu vào tài liệu/repo. Phần mô phỏng lấy cấu trúc semantic với nội dung thử.
