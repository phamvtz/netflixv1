'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../db/migrate');
const { runSeed } = require('../db/seed');
const {
  getUserByEmail,
  getUserById,
  getProfilesByUserId,
  createSession,
  getSession,
  deleteSession,
  getAllContent,
  createKey,
  resolveKeyEmail,
  getAllKeys,
  deleteKey,
  getAdminStats,
} = require('../db/queries');
const { parseSubdomain } = require('../subdomain');
const { content } = require('../data/content');

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  runSeed(db);
  return db;
}

describe('SQLite database layer', () => {
  let db;

  before(() => {
    db = createTestDb();
  });

  it('runMigrations là callable và không throw trên DB mới', () => {
    const fresh = new DatabaseSync(':memory:');
    fresh.exec('PRAGMA foreign_keys = ON');
    assert.doesNotThrow(() => runMigrations(fresh));
    assert.doesNotThrow(() => runMigrations(fresh));
  });

  it('getUserByEmail trả null với email không tồn tại', () => {
    assert.equal(getUserByEmail('unknown@test.com', db), null);
  });

  it('runSeed chèn đúng 2 users u001 và u002', () => {
    const u1 = getUserById('u001', db);
    const u2 = getUserById('u002', db);
    assert.ok(u1);
    assert.ok(u2);
    assert.equal(u1.email, 'demo@netflix.com');
    assert.equal(u2.plan, 'Standard');
    assert.equal(Object.keys(u1).sort().join(','), 'email,id,name,password,plan');
  });

  it('runSeed chèn 4 profiles cho u001 và 2 cho u002', () => {
    assert.equal(getProfilesByUserId('u001', db).length, 4);
    assert.equal(getProfilesByUserId('u002', db).length, 2);
  });

  it('getAllContent trả đúng 37 items với genres/rows là array', () => {
    const all = getAllContent(db);
    assert.equal(all.length, 37);
    assert.ok(Array.isArray(all[0].genres));
    assert.ok(Array.isArray(all[0].rows));
    assert.equal(all.find(c => c.featured)?.title, 'Stranger Things');
  });

  it('session round-trip và delete', () => {
    createSession('sess-test-1', 'u001', db);
    const row = getSession('sess-test-1', db);
    assert.ok(row);
    assert.equal(row.user_id, 'u001');
    deleteSession('sess-test-1', db);
    assert.equal(getSession('sess-test-1', db), null);
  });

  it('content source có đúng 37 items', () => {
    assert.equal(content.length, 37);
  });

  it('keys: create → resolve (tăng used_count) → list → delete', () => {
    createKey('SK-TEST-0001', 'buyer@tinyhost.shop', 'đơn test', db);
    const email = resolveKeyEmail('SK-TEST-0001', db);
    assert.equal(email, 'buyer@tinyhost.shop');

    const all = getAllKeys(db);
    const row = all.find(k => k.key === 'SK-TEST-0001');
    assert.ok(row);
    assert.equal(row.usedCount, 1);
    assert.equal(row.note, 'đơn test');

    assert.equal(resolveKeyEmail('SK-NOPE', db), null);
    assert.equal(deleteKey('SK-TEST-0001', db), true);
    assert.equal(resolveKeyEmail('SK-TEST-0001', db), null);
  });

  it('getAdminStats trả đủ các bảng', () => {
    const s = getAdminStats(db);
    assert.equal(s.users, 2);
    assert.equal(s.profiles, 6);
    assert.equal(s.content, 37);
    assert.equal(typeof s.keys, 'number');
  });
});

describe('Subdomain parsing', () => {
  const cases = [
    ['me.example.com', 'me'],
    ['seller.example.com:3002', 'seller'],
    ['admin.netflix.local', 'admin'],
    ['me.lvh.me:3002', 'me'],
    ['localhost', 'main'],
    ['localhost:3002', 'main'],
    ['127.0.0.1:3002', 'main'],
    ['example.com', 'main'],
    ['www.example.com', 'main'],
    ['', 'main'],
  ];
  for (const [host, expected] of cases) {
    it(`"${host}" → ${expected}`, () => {
      assert.equal(parseSubdomain(host), expected);
    });
  }
});
