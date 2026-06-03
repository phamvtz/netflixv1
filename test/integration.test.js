'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../db/migrate');
const { runSeed } = require('../db/seed');
const { deleteExpiredSessions, getAllContent } = require('../db/queries');

describe('Integration: startup sequence', () => {
  let tmpDir;
  let dbPath;
  let db;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netflix-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    runMigrations(db);
    runSeed(db);
    deleteExpiredSessions(db);
  });

  after(() => {
    try { db.close(); } catch { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('schema_migrations có 8 version', () => {
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    assert.deepEqual(rows.map(r => r.version), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('PRAGMA journal_mode = wal và foreign_keys = ON', () => {
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  });

  it('tất cả bảng được populate sau migrate + seed', () => {
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c, 6);
    assert.equal(getAllContent(db).length, 37);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE role='admin'").get().c, 1);
  });

  it('.gitignore chứa netflix.db và wal/shm', () => {
    const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    assert.match(gitignore, /\*\.db/);
    assert.match(gitignore, /\*\.db-wal/);
    assert.match(gitignore, /\*\.db-shm/);
  });
});
