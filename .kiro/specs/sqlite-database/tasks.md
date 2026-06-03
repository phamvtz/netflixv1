# Implementation Plan: SQLite Database Integration

## Overview

Replace all in-memory mock data (`USERS`, `PROFILES`, `sessions` Map, `data/content.js` require) with a persistent SQLite database using Node.js 22+'s built-in `node:sqlite` module. The implementation is split into five phases: database foundation, migration system, query layer, server wiring, and testing.

## Tasks

- [ ] 1. Set up database foundation and install fast-check
  - Install `fast-check` as a dev dependency: `npm install --save-dev fast-check`
  - Create `db/database.js` with a singleton `DatabaseSync` instance pointing to `./netflix.db`
  - Enable `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON` immediately after connection
  - Register a `process.on('exit')` handler that calls `db.close()` inside a try/catch
  - Export the `db` instance as the module default
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 2. Implement migration system
  - [ ] 2.1 Create `db/migrate.js` with `runMigrations()` function
    - Create `schema_migrations` table if it doesn't exist (columns: `version` INTEGER PRIMARY KEY, `applied_at` INTEGER DEFAULT unixepoch())
    - Read all applied versions from `schema_migrations`
    - Filter to unapplied migrations, sort ascending by version
    - Wrap each migration in a transaction: call `migration.up(db)`, insert version into `schema_migrations`; on error rollback and re-throw with version number in message
    - Export `runMigrations()`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 2.9_

  - [ ] 2.2 Define the four UP/DOWN migrations inside `db/migrate.js`
    - Migration 1: CREATE TABLE `users` (id TEXT PK, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, plan TEXT NOT NULL, created_at INTEGER DEFAULT unixepoch()); DOWN drops `users`
    - Migration 2: CREATE TABLE `profiles` (id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, color TEXT NOT NULL, initial TEXT NOT NULL, sort_order INTEGER DEFAULT 0, PRIMARY KEY (id, user_id)); DOWN drops `profiles`
    - Migration 3: CREATE TABLE `sessions` (session_id TEXT PK, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER DEFAULT unixepoch(), expires_at INTEGER NOT NULL); DOWN drops `sessions`
    - Migration 4: CREATE TABLE `content` (id INTEGER PK, title TEXT NOT NULL, type TEXT NOT NULL, seasons INTEGER, duration TEXT, genres TEXT NOT NULL, rating TEXT NOT NULL, maturity TEXT NOT NULL, year INTEGER NOT NULL, description TEXT NOT NULL, gradient TEXT NOT NULL, accent TEXT NOT NULL, rows TEXT NOT NULL, featured INTEGER DEFAULT 0, progress INTEGER); DOWN drops `content`
    - _Requirements: 2.5, 2.6, 3.1, 4.1, 5.1, 6.1_

  - [ ]* 2.3 Write property test for migration idempotency (Property 1)
    - **Property 1: Migration idempotency — only unapplied migrations run**
    - **Validates: Requirements 2.2, 2.4**
    - Use `fc.array(fc.integer({min:1,max:4}))` to generate sets of already-applied versions; verify `runMigrations()` applies exactly the missing ones
    - Tag: `// Feature: sqlite-database, Property 1: Migration idempotency`

  - [ ]* 2.4 Write property test for ascending execution order (Property 2)
    - **Property 2: Migrations execute in ascending version order**
    - **Validates: Requirements 2.3**
    - Use `fc.shuffledSubarray([1,2,3,4])` to shuffle migration definitions; verify execution order is always ascending
    - Tag: `// Feature: sqlite-database, Property 2: Ascending execution order`

  - [ ]* 2.5 Write property test for UP/DOWN round-trip (Property 3)
    - **Property 3: Migration UP/DOWN round-trip restores schema state**
    - **Validates: Requirements 2.5, 2.6**
    - Use `fc.integer({min:1,max:4})` for migration version; run UP then DOWN, verify table no longer exists and version removed from `schema_migrations`
    - Tag: `// Feature: sqlite-database, Property 3: UP/DOWN round-trip`

  - [ ]* 2.6 Write property test for failed migration rollback (Property 4)
    - **Property 4: Failed migration is fully rolled back**
    - **Validates: Requirements 2.7**
    - Use `fc.integer({min:1,max:4})` for failing migration version; inject a throwing `up()`, verify no partial schema changes persist
    - Tag: `// Feature: sqlite-database, Property 4: Failed migration rollback`

  - [ ]* 2.7 Write property test for error message includes version (Property 5)
    - **Property 5: Failed migration error includes version number**
    - **Validates: Requirements 2.8**
    - Use `fc.integer({min:1,max:100})` for version number; verify re-thrown error message contains the version as a substring
    - Tag: `// Feature: sqlite-database, Property 5: Error includes version`

- [ ] 3. Implement seeder
  - [ ] 3.1 Create `db/seed.js` with `runSeed()` function
    - For each table (`users`, `profiles`, `content`), check `SELECT COUNT(*) FROM <table>`; skip if count > 0
    - Seed `users` with exactly 2 rows: `{id:'u001', email:'demo@netflix.com', password:'demo123', name:'Demo User', plan:'Premium'}` and `{id:'u002', email:'user@netflix.com', password:'user123', name:'Netflix User', plan:'Standard'}`
    - Seed `profiles` with 4 rows for `u001` (p1 User 1 #E50914 U1, p2 User 2 #0071EB U2, p3 Kids #F5A623 KD, p4 Guest #54B83F GS) and 2 rows for `u002` (p1 Main #E50914 MN, p2 Partner #9B59B6 PT), with `sort_order` matching array index
    - Seed `content` by importing `data/content.js`, serializing `genres` and `rows` arrays to JSON strings via `JSON.stringify()`, and inserting all 37 rows inside a transaction
    - Export `runSeed()`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 6.2, 6.3_

  - [ ]* 3.2 Write property test for seeder idempotency (Property 16)
    - **Property 16: Seeder is idempotent — running twice does not duplicate rows**
    - **Validates: Requirements 7.1, 7.6**
    - Run `runSeed()` twice on an in-memory DB; verify row counts for `users`, `profiles`, `content` are identical after both calls
    - Tag: `// Feature: sqlite-database, Property 16: Seeder idempotency`

  - [ ]* 3.3 Write property test for seeded content matching source (Property 17)
    - **Property 17: Seeded content items match source data exactly**
    - **Validates: Requirements 7.4**
    - Use `fc.constantFrom(...content)` to pick random content items; after `runSeed()`, query by `id` and verify all fields match (with arrays deserialized)
    - Tag: `// Feature: sqlite-database, Property 17: Seeded content matches source`

- [ ] 4. Implement query layer
  - [ ] 4.1 Create `db/queries.js` with user query functions
    - Implement `getUserByEmail(email)`: `SELECT * FROM users WHERE email = ?`, return row or `null`
    - Implement `getUserById(id)`: `SELECT * FROM users WHERE id = ?`, return row or `null`
    - Both functions return plain objects with keys `id`, `email`, `password`, `name`, `plan` (no `created_at`)
    - _Requirements: 3.2, 3.3, 3.4_

  - [ ]* 4.2 Write property test for user camelCase fields (Property 6)
    - **Property 6: User query returns camelCase fields**
    - **Validates: Requirements 3.3**
    - Use `fc.record({id: fc.uuid(), email: fc.emailAddress(), password: fc.string(), name: fc.string(), plan: fc.string()})` to generate user records; insert and query back, verify keys are exactly `id`, `email`, `password`, `name`, `plan` with no `created_at`
    - Tag: `// Feature: sqlite-database, Property 6: User camelCase fields`

  - [ ] 4.3 Create profile query functions in `db/queries.js`
    - Implement `getProfilesByUserId(userId)`: `SELECT id, user_id as userId, name, color, initial FROM profiles WHERE user_id = ? ORDER BY sort_order ASC`, return array
    - Implement `getProfileByIdAndUserId(profileId, userId)`: `SELECT id, user_id as userId, name, color, initial FROM profiles WHERE id = ? AND user_id = ?`, return row or `null`
    - _Requirements: 4.2, 4.3, 4.4_

  - [ ]* 4.4 Write property test for profiles sorted by sort_order (Property 7)
    - **Property 7: Profiles are returned sorted by sort_order ascending**
    - **Validates: Requirements 4.2**
    - Use `fc.array(fc.integer({min:0,max:100}), {minLength:1,maxLength:10})` for sort_order values; insert profiles with those values, verify `getProfilesByUserId()` returns them in non-decreasing order
    - Tag: `// Feature: sqlite-database, Property 7: Profiles sorted by sort_order`

  - [ ]* 4.5 Write property test for profile ownership enforcement (Property 8)
    - **Property 8: Profile ownership is enforced**
    - **Validates: Requirements 4.3**
    - Use `fc.string()` for two distinct userId values; insert profile for userA, query with userB's id, verify result is `null`
    - Tag: `// Feature: sqlite-database, Property 8: Profile ownership`

  - [ ]* 4.6 Write property test for profile camelCase fields (Property 9)
    - **Property 9: Profile query returns camelCase fields**
    - **Validates: Requirements 4.4**
    - Use `fc.record({id: fc.string(), userId: fc.string(), name: fc.string(), color: fc.string(), initial: fc.string()})` to generate profile records; insert and query back, verify keys are exactly `id`, `userId`, `name`, `color`, `initial` with no `user_id`
    - Tag: `// Feature: sqlite-database, Property 9: Profile camelCase fields`

  - [ ] 4.7 Create session query functions in `db/queries.js`
    - Implement `createSession(sessionId, userId)`: insert row with `expires_at = Math.floor(Date.now()/1000) + 2592000`
    - Implement `getSession(sessionId)`: select by `session_id`; if not found return `null`; if `expires_at <= now` delete row and return `null`; otherwise return row
    - Implement `deleteSession(sessionId)`: delete row by `session_id`
    - Implement `deleteExpiredSessions()`: delete all rows where `expires_at <= Math.floor(Date.now()/1000)`
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.7_

  - [ ]* 4.8 Write property test for session expires_at value (Property 10)
    - **Property 10: Session creation sets expires_at to now + 30 days**
    - **Validates: Requirements 5.2**
    - Use `fc.string()` for sessionId and userId; after `createSession()`, query raw row and verify `expires_at` is within 5 seconds of `Math.floor(Date.now()/1000) + 2592000`
    - Tag: `// Feature: sqlite-database, Property 10: Session expires_at`

  - [ ]* 4.9 Write property test for session lookup round-trip (Property 11)
    - **Property 11: Session lookup round-trip returns correct user_id**
    - **Validates: Requirements 5.3**
    - Use `fc.string()` for sessionId/userId pairs; create session then call `getSession()`, verify returned object contains the same `user_id`
    - Tag: `// Feature: sqlite-database, Property 11: Session lookup round-trip`

  - [ ]* 4.10 Write property test for expired session returns null (Property 12)
    - **Property 12: Expired sessions return null and are deleted**
    - **Validates: Requirements 5.4**
    - Use `fc.integer({min:1,max:1000})` for seconds in the past; insert session with `expires_at = now - N`, call `getSession()`, verify `null` returned and row deleted
    - Tag: `// Feature: sqlite-database, Property 12: Expired session returns null`

  - [ ]* 4.11 Write property test for deleted session not retrievable (Property 13)
    - **Property 13: Deleted sessions are not retrievable**
    - **Validates: Requirements 5.5**
    - Use `fc.string()` for sessionId; create then delete session, verify `getSession()` returns `null`
    - Tag: `// Feature: sqlite-database, Property 13: Deleted session not retrievable`

  - [ ]* 4.12 Write property test for startup cleanup (Property 14)
    - **Property 14: Startup cleanup removes only expired sessions**
    - **Validates: Requirements 5.7**
    - Use `fc.array(fc.integer())` for mixed expiry timestamps; insert sessions with those timestamps, call `deleteExpiredSessions()`, verify only rows with `expires_at > now` remain
    - Tag: `// Feature: sqlite-database, Property 14: Startup cleanup`

  - [ ] 4.13 Create content query function in `db/queries.js`
    - Implement `getAllContent()`: `SELECT * FROM content`, map each row to parse `genres` and `rows` JSON strings back to arrays, convert `featured` integer to boolean (1 → `true`, 0 → `undefined`), convert `progress` null to `undefined`
    - _Requirements: 6.4, 6.5_

  - [ ]* 4.14 Write property test for content JSON round-trip (Property 15)
    - **Property 15: Content genres/rows round-trip through JSON serialization**
    - **Validates: Requirements 6.2, 6.3, 6.4**
    - Use `fc.array(fc.string())` for genres and rows arrays; insert content with those arrays serialized, query back via `getAllContent()`, verify arrays are deeply equal to originals
    - Tag: `// Feature: sqlite-database, Property 15: Content JSON round-trip`

- [ ] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Wire database into server.js
  - [ ] 6.1 Add startup block and remove mock data from `server.js`
    - Add `require('./db/database')` at the top (singleton initialization)
    - Add `require` imports for `runMigrations` from `./db/migrate` and `runSeed` from `./db/seed`
    - Add startup block before `app.listen()`: call `runMigrations()` then `runSeed()` inside try/catch; on error log and `process.exit(1)`
    - Remove the `USERS` array, `PROFILES` object, and `sessions` Map declarations
    - _Requirements: 8.1, 8.2, 8.8_

  - [ ] 6.2 Replace auth and session references in `server.js`
    - Add `require` import for `{ getUserByEmail, getUserById, createSession, getSession, deleteSession, deleteExpiredSessions }` from `./db/queries`
    - In `setSessionCookies`: replace `sessions.set(sessionId, userId)` with `createSession(sessionId, userId)`
    - In `clearSessionCookies`: replace `sessions.delete(sessionId)` with `deleteSession(sessionId)`
    - In `decodeNetflixId`: replace `sessions.get(sessionId)` with `getSession(sessionId)` (note: `getSession` returns a row object with `user_id`, adjust destructuring accordingly)
    - In `requireAuth`: replace `USERS.find(u => u.id === decoded.userId)` with `getUserById(decoded.userId)`
    - In `POST /api/auth/login`: replace `USERS.find(u => u.email === email && u.password === password)` with `getUserByEmail(email)` + separate password comparison
    - Call `deleteExpiredSessions()` in the startup block after `runSeed()`
    - _Requirements: 8.3, 8.5, 5.6, 5.7_

  - [ ] 6.3 Replace profiles and content references in `server.js`
    - Add `require` import for `{ getProfilesByUserId, getProfileByIdAndUserId, getAllContent }` from `./db/queries`
    - Replace `PROFILES[userId]` lookups with `getProfilesByUserId(userId)`
    - Replace `profiles.find(p => p.id === profileId)` with `getProfileByIdAndUserId(profileId, userId)`
    - Replace `require('./data/content')` with a call to `getAllContent()`
    - _Requirements: 8.4, 8.6, 8.7, 6.6_

- [ ] 7. Update `.gitignore`
  - Add `netflix.db`, `netflix.db-wal`, and `netflix.db-shm` entries to `.gitignore`
  - _Requirements: 9.1, 9.2, 9.3_

- [ ] 8. Write unit and integration tests
  - [ ] 8.1 Write unit tests in `test/db.test.js` using `node:test`
    - Test `getUserByEmail` returns `null` for unknown email (Requirement 3.4)
    - Test `runSeed()` inserts exactly 2 users with IDs `u001` and `u002` (Requirement 7.2)
    - Test `runSeed()` inserts 4 profiles for `u001` and 2 profiles for `u002` (Requirement 7.3)
    - Test `runMigrations()` is a callable function that does not throw on a fresh DB (Requirement 2.9)
    - Test `db/database.js` exports a `DatabaseSync` instance with `exec` method (Requirement 1.5)
    - Use `:memory:` database for isolation
    - _Requirements: 2.9, 3.4, 7.2, 7.3_

  - [ ]* 8.2 Write integration tests in `test/integration.test.js`
    - Full startup sequence: `runMigrations()` + `runSeed()` on a temp file DB; verify all four tables exist and are populated
    - Verify `PRAGMA journal_mode` returns `'wal'` and `PRAGMA foreign_keys` returns `1`
    - Verify `schema_migrations` table has 4 rows after `runMigrations()`
    - Verify `.gitignore` contains `netflix.db`, `netflix.db-wal`, `netflix.db-shm` entries
    - _Requirements: 1.3, 1.4, 2.1, 7.2, 7.3, 7.4, 9.3_

- [ ] 9. Final checkpoint — Ensure all tests pass
  - Run `node --test` to execute all tests in `test/`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- All property tests use `fast-check` with a minimum of 100 iterations per property
- All unit/property tests use `:memory:` SQLite databases for full isolation
- Integration tests use a temporary file-based DB that is cleaned up after the test run
- The `node:sqlite` module requires Node.js 22+; verify with `node --version` before running
- `decodeNetflixId` currently reads from the `sessions` Map — after Task 6.2, it will call `getSession()` which returns a row object; the destructuring `{ userId, sessionId }` must be updated to read `row.user_id` as `userId`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "2.6", "2.7", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.1", "4.3", "4.7", "4.13"] },
    { "id": 4, "tasks": ["4.2", "4.4", "4.5", "4.6", "4.8", "4.9", "4.10", "4.11", "4.12", "4.14"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7"] },
    { "id": 7, "tasks": ["8.1", "8.2"] }
  ]
}
```
