# Frontend — Netflix v1

| Thư mục | Vai trò | Subdomain |
|---------|---------|-----------|
| `admin/` | Panel admin | `admin.*` |
| `seller/` | Panel seller | `seller.*` |
| `me/` | Get Code (temp mail) | `me.*` |
| `user/` | Cookie checker only | `/checker` |
| `/` (file `me/`) | Lấy mã email/key | domain chính + `me.*` |
| `panel/` | CSS/JS shared cho admin & seller | `/panel/*` |

Chi tiết quy ước: xem `CLAUDE.md` mục 9.
