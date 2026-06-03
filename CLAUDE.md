# CLAUDE.md — Workspace Configuration

## 1. CLAUDE là ai & Context

CLAUDE là AI assistant cho solo full-stack developer, làm việc trên 2 dự án: **Netflix v1** (cookie checker, thư mục này) và **Mail Seller** (`d:\mail-seller`, SaaS panel bán email). Stack Node.js + Express.js, deploy VPS qua SSH + PM2. Mọi thay đổi được commit tự động. Giao tiếp tiếng Việt, comment code tiếng Việt.

---

## 2. Tech Stack

- **Runtime**: Node.js (LTS) · **Framework**: Express.js
- **Database**: SQLite (node:sqlite built-in) / Turso cloud (`@libsql/client`) — raw SQL
- **Process Manager**: PM2 · **Deploy**: VPS + SSH + `git pull` + `pm2 restart`
- **Testing**: TDD — Vitest hoặc Jest · **Env**: `.env` local, server env var

---

## 3. Quy tắc code

- `camelCase` JS — `snake_case` DB columns
- Comment tiếng Việt, giải thích "tại sao" không phải "cái gì"
- `async/await` — không callback lồng nhau
- Luôn `try/catch`, trả lỗi rõ ràng: `{ success: false, error }`
- Không `var`, không unused vars, hàm nhỏ làm một việc
- Prepared statements — tránh N+1 query
- API response chuẩn: `{ success, data }` hoặc `{ success: false, error }`

```js
// Map DB -> JS tại query layer
const mapRow = r => ({ userId: r.user_id, createdAt: r.created_at });
```

---

## 4. Quy trình làm việc

### Bắt đầu session — tự làm ngay
1. Đọc cấu trúc thư mục (`ls` 2 level)
2. `git log --oneline -5`
3. Kiểm tra `.env` tồn tại, cảnh báo nếu thiếu
4. Tóm tắt rules file này

### Auto-commit format
```
feat|fix|refactor|chore: mô tả ngắn tiếng Việt
```

### Deploy (VPS + PM2)
```bash
git push && ssh user@vps "cd /project && git pull && pm2 restart app"
curl http://localhost:PORT/api/ping   # verify
```

---

## 5. Tự động hóa

- **Auto-commit**: Sau mỗi sửa → `git add -A && git commit -m "..."`
- **Auto lint**: `node --check` trước commit
- **Auto CHANGELOG**: Thêm entry khi có feat/fix
- **Auto security fix**: Phát hiện lỗ hổng → fix ngay, không hỏi
- **Refactor scope**: Được phép refactor rộng — không giới hạn

---

## 6. Agents

| Agent | Dùng khi |
|---|---|
| `@debugger` | Stack trace, 500, PM2 crash, DB error |
| `@code-reviewer` | Trước commit lớn / deploy |
| `@db-migration` | Thêm bảng/cột/schema |
| `@deploy` | Deploy VPS, verify health |

## 7. Skills

| Skill | Hành động |
|---|---|
| `/debug` | Parse trace → root cause → fix → commit |
| `/ship` | Lint → test → commit → push → SSH → pm2 restart → verify |
| `/new-feature [name]` | Tạo route + test + register + CHANGELOG |
| `/review` | git diff → check CRITICAL/WARN/INFO → auto-fix CRITICAL |

---

## 8. KHÔNG làm gì

- Không over-engineer, không abstraction thừa, không ORM phức tạp khi raw SQL đủ
- Không TODO không có plan, không hỏi lại khi task đã rõ
- Không commit `.env`, `node_modules`, file build tạm
