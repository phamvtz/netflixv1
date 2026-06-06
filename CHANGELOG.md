# Changelog

## [Unreleased]

### Added
- Seller deposit history: new "Deposit history" table in the seller workspace Deposit view showing all bank transfers recorded for the account (gateway, bank tx ref, amount, memo, status), backed by `GET /api/seller/deposits`.
- Admin deposit review: new "Deposits" tab in the admin panel listing unmatched bank transfers with a per-row seller dropdown to manually assign + credit them (`GET /api/admin/deposit-intents/unmatched`, `POST /api/admin/deposit-intents/:id/assign`), plus a recent-deposits table.
- Bank deposit webhook (`POST /api/deposit/webhook`): auto-credits a seller's balance on incoming bank transfer. Supports Casso (array payload) and SePay (single object) formats, authorizes via `BANK_WEBHOOK_TOKEN` (Bearer header or `?token=`), matches the seller by memo prefix (`BANK_MEMO_PREFIX`, default `NAP`), and is idempotent via a UNIQUE `tx_ref` in the new `deposit_intents` table (migration v11). Seller deposit config exposed via `GET /api/deposit/config`; admin visibility via `GET /api/admin/deposit-intents`.
- Admin dashboard: Redesigned the dashboard view to use high-fidelity, tab-based navigation instead of vertically stacked panels to improve usability. Active tab state is persisted in sessionStorage.
- Admin layout: Aligned the dashboard panels inside a centered layout container (`1200px` max-width) to improve visual density and readability on larger screens.

### Changed
- Seller workspace JS split from one 1040-line `seller.js` into per-view modules under `public/seller/js/`: `seller-core` (state/helpers/api/switchView), `seller-dashboard`, `seller-orders`, `seller-store`, `seller-emails`, `seller-transactions` (+deposit), `seller-profile`, `seller-auth`, and `seller-app` (bootstrap, loaded last). Classic scripts sharing global scope — no behavior change, 55/55 tests pass.
- Subdomain Routing: Split pages into specific paths per subdomain: `me.domain/me` (Get Code), `admin.domain/admin` (Admin Panel), and `seller.domain/seller` (Seller Workspace) with root `/` redirecting to their respective paths.
- Get Code (`me/`): inbox form layout like reference — centered card, blue tabs/button, Turnstile, separate result card with green badge + blue spaced code; shared `form-card.css`; lang **Auto (by IP)** / EN / VI.
- Seller auth: same lang dropdown + `form-card.css` tokens.
- UI: **light B&W** — white background, black text; primary buttons black-on-white; `bw-flat.css` on all panel pages.

### Fixed
- Bank webhook crash: `recordDepositIntent`/`assignDepositIntent` used `conn.transaction()` (a better-sqlite3 API) which does not exist on `node:sqlite` — replaced with a `runInTransaction` BEGIN/COMMIT/ROLLBACK helper so auto-credit and manual assign actually work.
- Checker: tài khoản **LIVE** UI tiếng Việt (Gói Cao cấp + ngày thanh toán tương lai) không còn báo nhầm **PLAN LOST** khi thiếu nút Cancel tiếng Anh / `data-uia` payment.
- Checker: **ngày thanh toán tương lai** → luôn **LIVE**; bỏ false positive `cập nhật phương thức thanh toán`; `mergeCheckResults` không gán lại PLAN LOST sau khi server đã resolve.
- Checker: sửa false positive `"hasPaymentIssue":false` và từ khóa `payment issue` trong HTML → không còn MẤT GÓI khi có ngày TT tương lai (vd. `6 tháng 6, 2026`).

### Added
- UI depth (T1): `panel/css/depth.css` — cinematic scene for me/admin/checker, cyber glass for seller stats/cards.
- Get Code page: `me/me.css` red-black cinematic theme (replaces light inline styles).
- Brand layer: `brand.css`, `seller-cyber.css` — Outfit/JetBrains fonts, mesh grids, split Get Code hero, dark seller workspace, checker ops chrome.
- UI theme switched to **monochrome B&W** (white accent on `#0a0a0a`) across me, admin, seller, checker.

### Removed
- Netflix clone demo UI (`login`, `browse`, `profiles`, landing) and APIs (`/api/auth/*`, `/api/profiles*`, `/api/content`, `/api/session/info`). Checker + panel only.

### Fixed
- Checker: phát hiện **MẤT GÓI** — còn tên plan (Standard…) nhưng lỗi thanh toán / popup browse, không tính LIVE.
- Checker: trích email từ HTML Netflix mạnh hơn; mặc định `NFTOKEN_MODE=fallback` khi thiếu email (kể cả đã có plan).
- Checker: mặc định `stealth` — warmup browse→account, 1 UA/cookie, không nftoken, delay 20–45s, giới hạn 50 check/giờ.

### Added
- Seller: tab **Checker cookie** trong workspace — dán cookie tài khoản (mỗi dòng 1 set), kiểm tra LIVE/DEAD/mất gói tuần tự, cập nhật từng dòng; dùng lại `/api/checker/live-check`.
- Admin: tab **Quản lý sản phẩm** — bảng CRUD danh mục (thêm/sửa, ẩn/hiện), filter chips + search + modal dùng chung; nối API `GET/POST /api/admin/products`.
- Panel UI dùng chung (`public/panel/`), filter chips admin/seller, refactor checker (search + stat cards).
- Cấu trúc `public/`: `admin/`, `seller/`, `me/`, `user/`, tài liệu trong `CLAUDE.md` §9.
- Quyền mã Netflix: admin cấp seller (ĐN / Reset / Gia đình), seller gán subset cho từng key; inbox lọc theo key.
- Seller workspace UI (`seller-workspace.css`): sidebar, đơn hàng dạng card, pill quyền, thống kê, hồ sơ.
- Hệ thống đơn hàng seller (migration v10): sản phẩm, mua cửa hàng, số dư, giao dịch, gia hạn, lịch sử đơn.
- Trang **Quản lý Keys** (MMOJobs): bảng 6 cột, modal tạo 1–5 key (đồng bộ tên/hạn/quyền), modal sửa, đồng bộ/xóa key; API `GET/POST batch/PATCH/sync/DELETE /api/seller/keys`.

### Changed
- i18n: converted all user-facing UI text (customer, seller, admin pages + API messages) to English; English-only policy set in CLAUDE.md.
- Seller panel: logic keys tách `seller-keys.js`, nối qua `SellerApp`; tạo key từ đơn mở modal chọn tài khoản.
- Seller panel: quản lý key + modal sửa quyền; admin duyệt seller kèm chọn quyền.
- Giao diện seller kiểu MMOJobs (nền sáng, layout workspace).

### Changed
- Get Code: `public/me/index.html` (trước `user/getcode.html`).
- Route `/admin`, `/seller` trên domain chính.
