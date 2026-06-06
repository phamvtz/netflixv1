'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../db/migrate');
const { runSeed } = require('../db/seed');
const { hashPassword } = require('../auth');
const { createAccount, setAccountStatus } = require('../db/queries');
const {
  recordDepositIntent,
  findDepositIntentByRef,
  getDepositIntentsBySeller,
  listUnmatchedDepositIntents,
  assignDepositIntent,
  getSellerBalance,
} = require('../db/queries-orders');

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  runSeed(db);
  return db;
}

describe('Bank deposit intents', () => {
  let db;
  const sellerId = 'sel_dep_test';

  before(() => {
    db = createTestDb();
    createAccount({
      id: sellerId,
      username: 'depseller',
      email: 'dep@test.local',
      password: hashPassword('pass123'),
      role: 'seller',
    }, db);
    setAccountStatus(sellerId, 'active', db);
  });

  it('matched deposit credits the seller balance', () => {
    const out = recordDepositIntent({
      provider: 'casso',
      txRef: 'TX-100',
      amount: 50000,
      memo: 'NAP depseller',
      matchedUser: 'depseller',
      accountId: sellerId,
      payload: '{}',
    }, db);
    assert.equal(out.credited, true);
    assert.equal(out.balance, 50000);
    assert.equal(getSellerBalance(sellerId, db), 50000);
  });

  it('duplicate tx_ref is a no-op (idempotent)', () => {
    const out = recordDepositIntent({
      provider: 'casso',
      txRef: 'TX-100',
      amount: 50000,
      memo: 'NAP depseller',
      matchedUser: 'depseller',
      accountId: sellerId,
      payload: '{}',
    }, db);
    assert.equal(out.duplicate, true);
    // Balance unchanged
    assert.equal(getSellerBalance(sellerId, db), 50000);
  });

  it('deposit without an account is stored as unmatched', () => {
    const out = recordDepositIntent({
      provider: 'sepay',
      txRef: 'TX-200',
      amount: 30000,
      memo: 'random memo no username',
      matchedUser: null,
      accountId: null,
      payload: '{}',
    }, db);
    assert.equal(out.unmatched, true);
    const row = findDepositIntentByRef('sepay', 'TX-200', db);
    assert.equal(row.status, 'unmatched');
  });

  it('listUnmatchedDepositIntents returns only unmatched rows', () => {
    const rows = listUnmatchedDepositIntents(100, db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].txRef, 'TX-200');
  });

  it('getDepositIntentsBySeller returns the credited deposit', () => {
    const rows = getDepositIntentsBySeller(sellerId, 100, db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].txRef, 'TX-100');
    assert.equal(rows[0].status, 'credited');
  });

  it('admin assigns an unmatched deposit → credits seller', () => {
    const unmatched = listUnmatchedDepositIntents(100, db)[0];
    const out = assignDepositIntent(unmatched.id, sellerId, db);
    assert.ok(out.intent);
    assert.equal(out.intent.status, 'credited');
    assert.equal(out.balance, 80000); // 50000 + 30000
    assert.equal(getSellerBalance(sellerId, db), 80000);
    // No more unmatched
    assert.equal(listUnmatchedDepositIntents(100, db).length, 0);
  });

  it('assigning an already-credited deposit is rejected', () => {
    const credited = getDepositIntentsBySeller(sellerId, 100, db)
      .find((d) => d.txRef === 'TX-200');
    const out = assignDepositIntent(credited.id, sellerId, db);
    assert.ok(out.error);
    assert.match(out.error, /already credited/i);
  });

  it('assigning to a non-existent seller is rejected', () => {
    const out2 = recordDepositIntent({
      provider: 'casso',
      txRef: 'TX-300',
      amount: 10000,
      memo: 'no match',
      matchedUser: null,
      accountId: null,
      payload: '{}',
    }, db);
    assert.equal(out2.unmatched, true);
    const row = findDepositIntentByRef('casso', 'TX-300', db);
    const out = assignDepositIntent(row.id, 'sel_does_not_exist', db);
    assert.ok(out.error);
    assert.match(out.error, /not found|not active/i);
  });
});
