# Skill: /ship

**Trigger:** `/ship [optional commit message]`

## Pipeline (dừng ngay nếu bước nào fail)
1. `node --check` trên các file .js đã thay đổi
2. Chạy tests nếu có (`npm test`)
3. `git add -A`
4. `git commit -m "type: mô tả"` — dùng message truyền vào hoặc tự sinh
5. `git push`
6. SSH → `git pull` → `pm2 restart`
7. `curl /api/ping` → verify 200 OK

## Commit format
```
feat|fix|refactor|chore: mô tả ngắn tiếng Việt
```
