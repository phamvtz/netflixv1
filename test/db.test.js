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
  getKeysBySeller,
  deleteKey,
  getAdminStats,
  createAccount,
  getAccountByUsername,
  getAccountById,
  markEmailVerified,
  setAccountStatus,
  getPendingSellers,
  getSellers,
  createPanelSession,
  getPanelSession,
  deletePanelSession,
} = require('../db/queries');
const { parseSubdomain } = require('../subdomain');
const { content } = require('../data/content');
const { hashPassword, verifyPassword } = require('../auth');

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
    createKey('SK-TEST-0001', 'buyer@tinyhost.shop', 'đơn test', null, db);
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

describe('Accounts, panel sessions & seller keys', () => {
  let db;
  before(() => { db = createTestDb(); });

  it('admin account được seed: admin / Admin2026, active, verified', () => {
    const admin = getAccountByUsername('admin', db);
    assert.ok(admin);
    assert.equal(admin.role, 'admin');
    assert.equal(admin.status, 'active');
    assert.equal(admin.emailVerified, true);
    assert.equal(admin.email, 'hcjx125@gmail.com');
    assert.equal(verifyPassword(admin.password, 'Admin2026'), true);
    assert.equal(verifyPassword(admin.password, 'sai'), false);
  });

  it('seller flow: đăng ký pending → verify email → admin duyệt → active', () => {
    const acc = createAccount({
      id: 'sel_test', username: 'seller1', email: 's1@tinyhost.shop',
      password: hashPassword('seller123'), role: 'seller', verifyCode: '123456',
      verifyExpires: Math.floor(Date.now() / 1000) + 900,
    }, db);
    assert.equal(acc.status, 'pending');
    assert.equal(acc.emailVerified, false);
    assert.ok(getPendingSellers(db).some(s => s.id === 'sel_test'));

    markEmailVerified('sel_test', db);
    assert.equal(getAccountById('sel_test', db).emailVerified, true);

    assert.equal(setAccountStatus('sel_test', 'active', db), true);
    assert.equal(getAccountById('sel_test', db).status, 'active');
    assert.equal(getPendingSellers(db).some(s => s.id === 'sel_test'), false);
    assert.ok(getSellers(db).some(s => s.id === 'sel_test'));
  });

  it('panel session round-trip và delete', () => {
    createPanelSession('ps-1', 'acc_admin', db);
    const row = getPanelSession('ps-1', db);
    assert.ok(row);
    assert.equal(row.account_id, 'acc_admin');
    deletePanelSession('ps-1', db);
    assert.equal(getPanelSession('ps-1', db), null);
  });

  it('key gắn seller_id → getKeysBySeller trả đúng', () => {
    createKey('SK-SELLER-1', 'buyer@tinyhost.shop', null, 'sel_test', db);
    const keys = getKeysBySeller('sel_test', db);
    assert.equal(keys.length, 1);
    assert.equal(keys[0].key, 'SK-SELLER-1');
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
