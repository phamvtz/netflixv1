# Requirements Document

## Introduction

Feature này thay thế toàn bộ mock data in-memory của Netflix clone bằng SQLite database thật, sử dụng module `node:sqlite` built-in của Node.js 22+. Mục tiêu là giữ nguyên toàn bộ hành vi hiện tại (auth, session, profiles, content) nhưng dữ liệu được lưu trữ bền vững qua các lần restart server. Hệ thống bao gồm migration UP/DOWN, seed data giữ nguyên 2 demo accounts, và một lớp database module tách biệt khỏi server.js.

## Glossary

- **Database**: Module `node:sqlite` built-in của Node.js 22+, file `netflix.db` tại root project
- **Migration_Runner**: Module chịu trách nhiệm chạy UP/DOWN migrations theo thứ tự version
- **Seeder**: Module chèn dữ liệu mặc định vào các bảng rỗng khi khởi động
- **DB**: Singleton instance của DatabaseSync từ `node:sqlite`
- **Session**: Bản ghi trong bảng `sessions` thay thế `Map()` in-memory
- **User**: Bản ghi trong bảng `users` thay thế mảng `USERS`
- **Profile**: Bản ghi trong bảng `profiles` thay thế object `PROFILES`
- **Content_Item**: Bản ghi trong bảng `content` thay thế mảng trong `data/content.js`
- **Row_Array**: Trường lưu danh sách rows của content, serialize thành JSON string trong DB
- **Genre_Array**: Trường lưu danh sách genres của content, serialize thành JSON string trong DB

---

## Requirements

### Requirement 1: Database Module và Khởi Tạo

**User Story:** As a developer, I want a dedicated database module, so that all SQLite interactions are centralized and server.js stays clean.

#### Acceptance Criteria

1. THE Database SHALL be initialized using `node:sqlite`'s `DatabaseSync` class with file path `./netflix.db` relative to project root.
2. WHEN the database file does not exist, THE Database SHALL create it automatically on first connection.
3. THE Database SHALL enable WAL journal mode (`PRAGMA journal_mode = WAL`) immediately after connection.
4. THE Database SHALL enable foreign key enforcement (`PRAGMA foreign_keys = ON`) immediately after connection.
5. THE DB SHALL be exported as a singleton instance from `db/database.js` so all modules share one connection.
6. WHEN the server process exits, THE Database SHALL attempt to close the connection gracefully via a `process.on('exit')` handler; IF the closure fails, THE Database SHALL allow the process to exit regardless.

---

### Requirement 2: Migration System

**User Story:** As a developer, I want UP/DOWN migrations with version tracking, so that schema changes are reproducible and reversible.

#### Acceptance Criteria

1. THE Migration_Runner SHALL maintain a `schema_migrations` table with columns `version` (INTEGER PRIMARY KEY) and `applied_at` (INTEGER DEFAULT unixepoch()).
2. WHEN migrations are run, THE Migration_Runner SHALL execute only migrations whose `version` is not yet recorded in `schema_migrations`.
3. THE Migration_Runner SHALL execute migrations in ascending version order.
4. WHEN a migration UP succeeds, THE Migration_Runner SHALL insert the migration's version into `schema_migrations`.
5. THE Migration_Runner SHALL support DOWN migrations that reverse each UP migration's schema changes.
6. WHEN a DOWN migration is executed, THE Migration_Runner SHALL delete the corresponding version from `schema_migrations`.
7. THE Migration_Runner SHALL wrap each migration in a transaction so that partial failures are rolled back automatically.
8. IF a migration throws an error, THEN THE Migration_Runner SHALL re-throw the error with the migration version number included in the message.
9. THE Migration_Runner SHALL be implemented in `db/migrate.js` and export a `runMigrations()` function.

---

### Requirement 3: Users Table

**User Story:** As a developer, I want users stored in SQLite, so that user data persists across server restarts.

#### Acceptance Criteria

1. THE Database SHALL contain a `users` table with columns: `id` (TEXT PRIMARY KEY), `email` (TEXT UNIQUE NOT NULL), `password` (TEXT NOT NULL), `name` (TEXT NOT NULL), `plan` (TEXT NOT NULL), `created_at` (INTEGER DEFAULT unixepoch()).
2. WHEN a login request is received, THE Database SHALL query the `users` table by `email` alone, and THE Server SHALL verify the password in application code after the query returns.
3. THE Database SHALL return a user object with camelCase fields (`id`, `email`, `password`, `name`, `plan`) when queried from JS code.
4. IF no user matches the provided email, THEN THE Database SHALL return `undefined` or `null` from the query.

---

### Requirement 4: Profiles Table

**User Story:** As a developer, I want profiles stored in SQLite, so that each user's profiles persist and are queryable by user ID.

#### Acceptance Criteria

1. THE Database SHALL contain a `profiles` table with columns: `id` (TEXT NOT NULL), `user_id` (TEXT NOT NULL REFERENCES users(id)), `name` (TEXT NOT NULL), `color` (TEXT NOT NULL), `initial` (TEXT NOT NULL), `sort_order` (INTEGER DEFAULT 0), PRIMARY KEY (`id`, `user_id`).
2. WHEN a profiles list is requested for a user, THE Database SHALL return all profiles for that `user_id` ordered by `sort_order` ascending.
3. WHEN a profile selection is validated, THE Database SHALL query the `profiles` table by `id` AND `user_id` to confirm the profile belongs to the authenticated user.
4. THE Database SHALL return profile objects with camelCase fields (`id`, `userId`, `name`, `color`, `initial`) when queried from JS code.

---

### Requirement 5: Sessions Table

**User Story:** As a developer, I want sessions stored in SQLite, so that active sessions survive server restarts and users stay logged in.

#### Acceptance Criteria

1. THE Database SHALL contain a `sessions` table with columns: `session_id` (TEXT PRIMARY KEY), `user_id` (TEXT NOT NULL REFERENCES users(id)), `created_at` (INTEGER DEFAULT unixepoch()), `expires_at` (INTEGER NOT NULL).
2. WHEN a new session is created after login, THE Database SHALL insert a row into `sessions` with `expires_at` set to 30 days from creation (current unixepoch + 2592000).
3. WHEN `decodeNetflixId` resolves a session, THE Database SHALL look up `session_id` in the `sessions` table and return the associated `user_id`.
4. WHILE a session lookup is performed, THE Database SHALL verify that `expires_at` is greater than the current unixepoch(); IF the session is expired, THEN THE Database SHALL delete it and return `null`.
5. WHEN a logout is performed, THE Database SHALL delete the corresponding row from `sessions` by `session_id`.
6. THE Database SHALL replace the in-memory `sessions` Map in `server.js` with queries to the `sessions` table.
7. WHEN the server starts, THE Database SHALL delete all sessions where `expires_at` <= current unixepoch() to clean up stale records.

---

### Requirement 6: Content Table

**User Story:** As a developer, I want content stored in SQLite, so that content data can be queried, filtered, and extended without modifying source code.

#### Acceptance Criteria

1. THE Database SHALL contain a `content` table with columns: `id` (INTEGER PRIMARY KEY), `title` (TEXT NOT NULL), `type` (TEXT NOT NULL), `seasons` (INTEGER), `duration` (TEXT), `genres` (TEXT NOT NULL), `rating` (TEXT NOT NULL), `maturity` (TEXT NOT NULL), `year` (INTEGER NOT NULL), `description` (TEXT NOT NULL), `gradient` (TEXT NOT NULL), `accent` (TEXT NOT NULL), `rows` (TEXT NOT NULL), `featured` (INTEGER DEFAULT 0), `progress` (INTEGER).
2. THE Seeder SHALL serialize the `genres` array as a JSON string when inserting into the `genres` column.
3. THE Seeder SHALL serialize the `rows` array as a JSON string when inserting into the `rows` column.
4. WHEN content is queried from the database, THE Database SHALL parse the `genres` and `rows` JSON strings back into JavaScript arrays before returning.
5. WHEN the `/api/content` endpoint is called, THE Database SHALL return all content items with arrays properly deserialized.
6. THE Database SHALL replace the `require('./data/content')` call in `server.js` with a database query.

---

### Requirement 7: Seed Data

**User Story:** As a developer, I want seed data that matches the current mock data exactly, so that the demo accounts and all 37 content items work immediately after setup.

#### Acceptance Criteria

1. THE Seeder SHALL insert seed data only when the target table is empty (checked via `SELECT COUNT(*) FROM <table>`).
2. THE Seeder SHALL seed the `users` table with exactly 2 users: `demo@netflix.com` (plan: Premium) and `user@netflix.com` (plan: Standard), preserving the original IDs `u001` and `u002`.
3. THE Seeder SHALL seed the `profiles` table with 4 profiles for `u001` and 2 profiles for `u002`, matching the current `PROFILES` object in `server.js`.
4. THE Seeder SHALL seed the `content` table with all 37 items from `data/content.js`, preserving all field values including `featured` and `progress`.
5. THE Seeder SHALL be implemented in `db/seed.js` and export a `runSeed()` function.
6. WHEN `runSeed()` is called and all tables already contain data, THE Seeder SHALL skip all inserts without validating dependency order.

---

### Requirement 8: Server Integration

**User Story:** As a developer, I want server.js updated to use the database module, so that all mock data references are replaced without changing the external API behavior.

#### Acceptance Criteria

1. WHEN the server starts, THE Database SHALL run `runMigrations()` then `runSeed()` synchronously before `app.listen()` is called.
2. THE Server SHALL remove the `USERS` array, `PROFILES` object, and `sessions` Map from `server.js` after database integration.
3. THE Server SHALL replace all `USERS.find(...)` calls with database queries to the `users` table.
4. THE Server SHALL replace all `PROFILES[userId]` lookups with database queries to the `profiles` table.
5. THE Server SHALL replace all `sessions.set(...)`, `sessions.get(...)`, and `sessions.delete(...)` calls with database INSERT, SELECT, and DELETE operations on the `sessions` table.
6. WHEN the `/api/content` endpoint is called, THE Server SHALL query the `content` table instead of requiring `./data/content`.
7. THE Server SHALL preserve all existing API response shapes so that frontend JavaScript requires no changes.
8. IF the database initialization fails on startup, THEN THE Server SHALL log the error and exit immediately with a non-zero code, without attempting to start other services.

---

### Requirement 9: Database File Location và .gitignore

**User Story:** As a developer, I want the database file excluded from git, so that local data doesn't pollute the repository.

#### Acceptance Criteria

1. THE Database SHALL write the `netflix.db` file to the project root directory.
2. THE Database SHALL also create a `netflix.db-wal` and `netflix.db-shm` file as part of WAL mode operation.
3. THE `.gitignore` file SHALL include entries for `netflix.db`, `netflix.db-wal`, and `netflix.db-shm`.
