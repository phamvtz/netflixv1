# Changelog

## [Unreleased]

### Fixed
- Checker: phát hiện **MẤT GÓI** — còn tên plan (Standard…) nhưng lỗi thanh toán / popup browse, không tính LIVE.
- Checker: trích email từ HTML Netflix mạnh hơn; mặc định `NFTOKEN_MODE=fallback` khi thiếu email (kể cả đã có plan).
- Checker: mặc định `stealth` — warmup browse→account, 1 UA/cookie, không nftoken, delay 20–45s, giới hạn 50 check/giờ.

### Added
- Admin: tab **Quản lý sản phẩm** — bảng CRUD danh mục (thêm/sửa, ẩn/hiện), filter chips + search + modal dùng chung; nối API `GET/POST /api/admin/products`.
- Panel UI dùng chung (`public/panel/`), filter chips admin/seller, refactor checker (search + stat cards).
- Cấu trúc `public/`: `admin/`, `seller/`, `me/`, `user/`, tài liệu trong `CLAUDE.md` §9.
- Quyền mã Netflix: admin cấp seller (ĐN / Reset / Gia đình), seller gán subset cho từng key; inbox lọc theo key.
- Seller workspace UI (`seller-workspace.css`): sidebar, đơn hàng dạng card, pill quyền, thống kê, hồ sơ.
- Hệ thống đơn hàng seller (migration v10): sản phẩm, mua cửa hàng, số dư, giao dịch, gia hạn, lịch sử đơn.
- Trang **Quản lý Keys** (MMOJobs): bảng 6 cột, modal tạo 1–5 key (đồng bộ tên/hạn/quyền), modal sửa, đồng bộ/xóa key; API `GET/POST batch/PATCH/sync/DELETE /api/seller/keys`.

### Changed
- Seller panel: logic keys tách `seller-keys.js`, nối qua `SellerApp`; tạo key từ đơn mở modal chọn tài khoản.
- Seller panel: quản lý key + modal sửa quyền; admin duyệt seller kèm chọn quyền.
- Giao diện seller kiểu MMOJobs (nền sáng, layout workspace).

### Changed
- Get Code: `public/me/index.html` (trước `user/getcode.html`).
- Route `/admin`, `/seller` trên domain chính.
