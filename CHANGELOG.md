# Changelog

## [Unreleased]

### Added
- Admin "Grant order": admins can now create a Netflix account order directly for an active seller from the Sellers tab (a new "Grant order" button per seller opens a modal to pick a product or enter a custom name, account email/password, note, code permissions and via-email toggle). This wires up the previously unused `POST /api/admin/sellers/:id/orders` endpoint that the seller "ask the admin to grant an order" empty-state refers to; no balance is deducted. EN+VI i18n keys added.
- Warranty auto-check: sellers can store a Netflix cookie per order (`PATCH /api/seller/orders/:id` with `cookie`) so the server can periodically re-verify the account is still LIVE while under warranty. A background job (`WARRANTY_CHECK`, default on; `WARRANTY_INTERVAL_MIN` default 30m, `WARRANTY_MIN_INTERVAL_SEC` default 6h per order, `WARRANTY_BATCH` default 10) runs `fullCheck` on due orders and records the verdict (`live` / `payment_hold` / `plan_lost` / `dead` / `inconclusive`) into new `seller_orders` columns (migration v12: `cookie`, `last_check_status`, `last_checked_at`, `check_count`). The seller panel shows a colour-coded check badge per order plus a manual "Re-check" button (`POST /api/seller/orders/:id/recheck`). The raw cookie is server-only — never returned to clients (`mapOrderRow` exposes `hasCookie` boolean only). Added `test/warranty.test.js` (6 tests).
- Checker multilingual accuracy: `nfParseBillingDate` now understands Thai Buddhist-era years (e.g. 2570 BE → 2027 CE), Thai month names, and numeric `DD/MM/YYYY` / `D.M.YYYY` dates. New language-independent billing extractor `nfFindBillingDateInJson` reads SSR JSON keys (`nextBillingDate`, `nextRenewalDate`, `currentPeriodEnd`, …) as ISO strings or epoch s/ms, so a future renewal date resolves to LIVE regardless of UI language. Expanded cancel/manage/membership-ended/next-billing keyword sets and payment-hold phrases to TH/ID/JA/KO/DE/ES/FR. Added `test/nf-multilang.test.js` (11 tests).
- Seller deposit history: new "Deposit history" table in the seller workspace Deposit view showing all bank transfers recorded for the account (gateway, bank tx ref, amount, memo, status), backed by `GET /api/seller/deposits`.
- Admin deposit review: new "Deposits" tab in the admin panel listing unmatched bank transfers with a per-row seller dropdown to manually assign + credit them (`GET /api/admin/deposit-intents/unmatched`, `POST /api/admin/deposit-intents/:id/assign`), plus a recent-deposits table.
- Bank deposit webhook (`POST /api/deposit/webhook`): auto-credits a seller's balance on incoming bank transfer. Supports Casso (array payload) and SePay (single object) formats, authorizes via `BANK_WEBHOOK_TOKEN` (Bearer header or `?token=`), matches the seller by memo prefix (`BANK_MEMO_PREFIX`, default `NAP`), and is idempotent via a UNIQUE `tx_ref` in the new `deposit_intents` table (migration v11). Seller deposit config exposed via `GET /api/deposit/config`; admin visibility via `GET /api/admin/deposit-intents`.
- Admin dashboard: Redesigned the dashboard view to use high-fidelity, tab-based navigation instead of vertically stacked panels to improve usability. Active tab state is persisted in sessionStorage.
- Admin layout: Aligned the dashboard panels inside a centered layout container (`1200px` max-width) to improve visual density and readability on larger screens.

### Changed
- Seller panel i18n cleanup: removed all hardcoded Vietnamese/English strings that bypassed the EN/VI i18n layer so the whole seller workspace now switches language correctly. Wired the order search box + status filter tabs, buy modal (also dropped the stale `customer@tinyhost.shop` placeholder → `tempmail.id.vn`), create-key and edit-key modals, deposit "watching/minimum/amount" notes, and the meta description to `data-i18n`. Converted JS-rendered strings (order history labels + details, dynamic modal titles, key-count, store "New" badge and "From {price}") to `I18n.t` lookups. Added the matching EN+VI keys in `public/panel/js/i18n.js`; 100/100 tests still pass.
- Netflix message parsing moved out of `server.js` into the shared, unit-tested `lib/nf-email-parse.js` as `nfParseEmail` (`server.js` imports it; the `parseNetflixEmail` name is kept as an alias so both inbox call sites are unchanged). Extraction hardened for real-world EN + VI emails: login OTP is keyword-anchored (`mã đăng nhập` / `verification code` / `sign-in code` …) so order numbers and years are no longer mistaken for a code; household code now matches VI `Hộ gia đình` / `mã hộ gia đình` and requires a digit so a trailing word isn't grabbed; the reset link is detected independently of the login code (a stray digit no longer suppresses it) and only falls back to a `netflix.com` URL when its path is a password/account-security/login-help flow (logo/footer links are ignored). Added 7 EN+VI cases to `test/nf-email.test.js` (16/16 pass).
- Temp-mail provider is now pluggable via `MAIL_PROVIDER`: `tempmail` (default, tempmail.id.vn official API) or `generator` (generator.email HTML scrape). `fetchInboxForEmail` dispatches to the selected backend; both return the same `{ success, emails, total }` shape and run through the shared `parseNetflixEmail` + permission filter. generator.email support was reverse-engineered from the live site (mailbox rendered server-side at `GET /{email}` with a `surl` cookie; `/check_mail.php` is only a reload-signal poll), so the scraper GETs the mailbox page and parses message blocks structurally rather than by the obfuscated `e7m` class names. Note: generator.email is a shared/public inbox with no official API — kept as a fallback only; tempmail.id.vn (private, token-scoped) remains the recommended default.
- Temp-mail provider swapped from tinyhost.shop to **tempmail.id.vn** (Bearer-token, account-scoped API). `fetchInboxForEmail` now resolves the mailbox via `GET /api/email`, lists messages via `GET /api/email/{mailId}`, and fetches full bodies via `GET /api/message/{messageId}` when the list omits them, then runs the same Netflix parser + permission filter (login/reset/household). Configured via `TEMPMAIL_TOKEN` / `TEMPMAIL_API_BASE` / `TEMPMAIL_MAX_MESSAGES`; missing token → inbox returns empty (no crash). `/api/domains` now serves the allowed list from `TEMPMAIL_DOMAINS` (tempmail.id.vn has no random-domains endpoint). `parseNetflixEmail` field mapping widened to cover the new API's field names.
- Seller workspace JS split from one 1040-line `seller.js` into per-view modules under `public/seller/js/`: `seller-core` (state/helpers/api/switchView), `seller-dashboard`, `seller-orders`, `seller-store`, `seller-emails`, `seller-transactions` (+deposit), `seller-profile`, `seller-auth`, and `seller-app` (bootstrap, loaded last). Classic scripts sharing global scope — no behavior change, 55/55 tests pass.
- Subdomain Routing: Split pages into specific paths per subdomain: `me.domain/me` (Get Code), `admin.domain/admin` (Admin Panel), and `seller.domain/seller` (Seller Workspace) with root `/` redirecting to their respective paths.
- Get Code (`me/`): inbox form layout like reference — centered card, blue tabs/button, Turnstile, separate result card with green badge + blue spaced code; shared `form-card.css`; lang **Auto (by IP)** / EN / VI.
- Seller auth: same lang dropdown + `form-card.css` tokens.
- UI: **light B&W** — white background, black text; primary buttons black-on-white; `bw-flat.css` on all panel pages.

### Security
- Inbox API hardened: removed the unauthenticated `GET /api/inbox` (leaked all parsed codes without permission filtering); `POST /api/inbox` now fails closed — emails not bound to a valid key or a via-email order get 403 instead of unfiltered codes.
- Per-IP rate limits on abuse-prone endpoints: panel login (20/15m), seller register (10/h), verify-email (10/15m — blocks 6-digit OTP brute force), resend-code (5/15m), inbox lookup (30/5m).
- Batch checker: capped at `CHECK_BATCH_MAX` (default 50) cookies per request and each entry validated as a non-empty string; `/api/checker/debug` now counts against the hourly check budget and returns 429 when exhausted.
- Admin auth: `ADMIN_TOKEN` is accepted via the `X-Admin-Token` header only — query-string tokens (leak via logs/Referer/history) no longer work.
- Panel session cookie supports `Secure` flag via `COOKIE_SECURE=1` (enable behind TLS); admin manual top-up capped at 100,000,000đ per operation.
- 500 responses no longer echo raw exception messages (DB/internal/upstream details) — new `serverError` helper logs the real error server-side and returns a generic message; global Express error handler keeps 4xx messages (e.g. JSON parse) but genericizes 5xx. Rate-limit guidance messages are still surfaced.
- Checker endpoints now also have per-IP limits alongside the global hourly budget: live-check `CHECK_MAX_PER_HOUR`/h per IP, batch 10 requests/h per IP, debug 10/h per IP — one client can no longer silently burn the shared quota.

### Fixed
- Store purchase is now atomic: `purchaseProduct` debited the seller's balance and created the order in two separate steps with no transaction, so a failure after the debit (DB error, perm-clamp throw, etc.) could leave the seller charged without receiving an order. Wrapped the balance debit + order creation in `runInTransaction` (the same helper deposits already use) so both commit or both roll back together. Also fixed the purchase transaction description to English ("Purchase ..."). Added a rollback regression test in `test/orders.test.js` (injects an order-insert failure and asserts the balance is restored).
- Get Code via tempmail.id.vn returned **HTTP 500** for every valid lookup (`list.slice is not a function`): the provider wraps its message list as `{ success, message, data: { items: [...], pagination } }`, but `mailListOf` only unwrapped one level (`data.data`) and returned the inner `{ items, pagination }` object instead of an array, which then crashed on `.slice`. Extracted the temp-mail response normalizers into the unit-tested `lib/tempmail.js` (`mailListOf` now also reads `data.items`; new `mailBodyOf` safely unwraps a single message and never returns the `"message"` status string as a body), wired them back into `server.js`, and verified end-to-end against a real `tempmail.id.vn` inbox (`/api/inbox` → 200 with extracted Netflix sign-in code). Added `test/tempmail.test.js` (8 tests, incl. the nested-shape regression).
- Checker false LIVE on client-side payment holds: Netflix renders "account is on hold / retry your payment" banners client-side, so the server-side `/account` HTML can look fully active (`membershipStatus: CURRENT_MEMBER`, future "Next payment" date, valid card) even when the account is dead/on-hold. Checker now **verifies any HTML-only LIVE result with nftoken** (`fullCheck`, runs even in the `stealth` pace; toggle with `VERIFY_LIVE_NFTOKEN=0`), retries on transient/inconclusive nftoken responses (`VERIFY_LIVE_RETRIES`, default 2) to avoid failing open to a false LIVE, and a definitive nftoken DEAD/expired verdict overrides the HTML LIVE in `mergeCheckResults` → result becomes PLAN LOST. Inconclusive verification is surfaced as `verifyInconclusive`. Added `test/checker-merge.test.js` (4 tests). Note: this sends the cookie to nftoken.site and adds latency.
- Checker false LIVE on held accounts: an explicit `/account` hold banner ("Your account is on hold", "couldn't process your last payment", `isOnHold`/`pastDue` JSON flags) is now authoritative. A future "Next payment" date shown on a held account is only the retry date, so it no longer promotes the account to LIVE in either `nfResolveSubscriptionStatus` or `mergeCheckResults`. Added the `accountPaymentHold` signal to the merge step, expanded hold phrases ("couldn't/could not process", "retry your payment"), and added a regression test.
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
