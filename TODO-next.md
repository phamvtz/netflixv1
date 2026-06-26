# Việc còn lại — làm tiếp ngày mai

Ghi lại từ phiên audit ngày 2026-06-13 (branch `cursor/panel-ui-filters`).

## Đã xong
- `fix: remove fake store stock + dead store/transaction UI code` (`6b0b1a2`)
- `fix: enforce seller perms at get-code time` (`fc66cfc`)
- `fix: correct sync-perms hint to reflect order-inherit fallback` (`5422bea`)
  - Item 2: sửa câu hint (EN+VI+HTML fallback) cho khớp thực tế —
    tên/thời hạn có giá trị riêng khi tắt, nhưng quyền thì kế thừa quyền của đơn.
- `chore: track standalone checker-tool (pkg exe build)` (`435e7f1`)
  - Item 1: `checker-tool/` là bản standalone cố ý (README + `build:exe` pkg, không DB/Express).
    Track hẳn; `node_modules/` + `dist/` đã được `.gitignore` gốc cover.
  - ⚠️ Vẫn còn bản sao `public/panel/js/i18n.js` ở đây — sửa i18n ở root nhớ đồng bộ (theo README là copy cố ý).
- `fix: localize dates to UI language instead of hardcoded vi-VN` (`389a708`)
  - Item 3: thêm `I18n.locale()` (vi→`vi-VN`, en→`en-GB` để giữ thứ tự day/month/year).
    Áp cho 5 date formatter ở seller-core/keys/emails, admin, checker.
  - Currency toast (`đ`) giữ `vi-VN` vì VND là tiền tệ nghiệp vụ, không phải date locale.

## Còn lại (tùy chọn, ưu tiên thấp)

### 4. (cân nhắc) Tách type giao dịch admin top-up
- Hiện admin top-up (`server.js` ~2150) dùng `type: 'topup'`, gộp chung với nạp tự động qua webhook.
- Nếu muốn phân biệt "admin nạp tay" vs "nạp tự động" trên lịch sử GD → thêm type riêng
  (và khôi phục filter `admin_adjust` đã gỡ). Nghiệp vụ, không bắt buộc.
