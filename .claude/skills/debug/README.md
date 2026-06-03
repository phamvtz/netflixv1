# Skill: /debug

**Trigger:** `/debug [mô tả lỗi hoặc paste stack trace]`

## Quy trình 5 bước
1. Parse stack trace → xác định file/line (bỏ qua node_modules)
2. Đọc context ±20 dòng xung quanh
3. Nhận dạng pattern lỗi
4. Fix → test (TDD: thêm test case)
5. Auto commit: `fix: [mô tả ngắn]`

## Patterns thường gặp
| Lỗi | Fix nhanh |
|---|---|
| Cannot read property | Optional chaining `?.` hoặc guard clause |
| SQLITE_ERROR | Kiểm tra query params, prepared statement |
| UnhandledPromiseRejection | Thêm try/catch vào async route |
| PM2 restart loop | `pm2 logs --lines 50` tìm uncaught exception |
| Turso ECONNREFUSED | Kiểm tra TURSO_URL + TURSO_TOKEN trong .env |

## Output template
```
## Root Cause
[1-2 câu rõ ràng]

## Fix Applied
[code snippet]

## Prevention
[1 tip tránh tái phát]
```
