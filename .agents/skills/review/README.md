# Skill: /review

**Trigger:** `/review` — tự đọc `git diff HEAD`

## Checklist tự động
| Mức | Kiểm tra |
|---|---|
| CRITICAL | SQL injection, XSS, auth bypass, hardcoded secrets, floating promises |
| WARN | N+1 queries, thiếu error handling, camelCase/snake_case sai, sensitive data in logs |
| INFO | Cơ hội refactor, thiếu comment VN, thiếu test |

## Output
```
CRITICAL: <mô tả> — <file:line>
WARN:     <mô tả> — <file:line>
INFO:     <ghi chú>

Auto-fixed: [danh sách CRITICAL đã sửa và commit]
```

## Rules
- CRITICAL → tự fix ngay, không hỏi, commit luôn
- Refactor rộng nếu cần
