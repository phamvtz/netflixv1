# Skill: /new-feature

**Trigger:** `/new-feature [tên feature]`

## Tự động tạo
1. `routes/[name].js` — Express router, authMiddleware, async/await, try/catch
2. `tests/[name].test.js` — TDD: happy path + error case
3. Register trong `server.js`
4. Thêm entry vào `CHANGELOG.md`
5. Auto commit

## Naming
- Files: kebab-case.js | Functions: camelCase | DB columns: snake_case
- Comments: tiếng Việt

## Route template
```js
router.get('/', authMiddleware, async (req, res) => {
  try {
    res.json({ success: true, data: [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```
