'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../db/migrate');
const { runSeed } = require('../db/seed');
const { hashPassword } = require('../auth');
const { createAccount, setAccountStatus } = require('../db/queries');
const {
  getProducts,
  purchaseProduct,
  adjustBalance,
  getSellerOrders,
  updateSellerOrder,
  getOrderCookie,
  recordOrderCheck,
  listOrdersDueForCheck,
} = require('../db/queries-orders');

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  runSeed(db);
  return db;
}

describe('Warranty auto-check', () => {
  let db;
  let orderId;
  const sellerId = 'sel_warranty_test';

  before(() => {
    db = createTestDb();
    createAccount({
      id: sellerId,
      username: 'sellerwarr',
      email: 'warr@test.local',
      password: hashPassword('pass123'),
      role: 'seller',
    }, db);
    setAccountStatus(sellerId, 'active', db);
    adjustBalance(sellerId, 500000, { type: 'topup', description: 'Test' }, db);
    const product = getProducts(true, db)[0];
    const r = purchaseProduct(sellerId, product.id, {
      accountEmail: 'buyer@example.com',
      accountPassword: 'pw',
    }, db);
    orderId = r.order.id;
  });

  it('order mặc định chưa có cookie và chưa check', () => {
    const order = getSellerOrders(sellerId, db)[0];
    assert.equal(order.hasCookie, false);
    assert.equal(order.lastCheckStatus, null);
    assert.equal(order.checkCount, 0);
  });

  it('lưu cookie qua updateSellerOrder, không lộ giá trị ra mapOrderRow', () => {
    updateSellerOrder(orderId, sellerId, { cookie: 'NetflixId=abc; SecureNetflixId=def' }, db);
    const order = getSellerOrders(sellerId, db)[0];
    assert.equal(order.hasCookie, true);
    // mapOrderRow must NOT expose the raw cookie
    assert.equal(order.cookie, undefined);
    // internal getter returns it (server-side only)
    assert.equal(getOrderCookie(orderId, sellerId, db), 'NetflixId=abc; SecureNetflixId=def');
  });

  it('getOrderCookie bị scope theo seller (không đọc chéo)', () => {
    assert.equal(getOrderCookie(orderId, 'someone_else', db), null);
  });

  it('recordOrderCheck cập nhật status + tăng check_count', () => {
    recordOrderCheck(orderId, 'live', db);
    let order = getSellerOrders(sellerId, db)[0];
    assert.equal(order.lastCheckStatus, 'live');
    assert.equal(order.checkCount, 1);
    assert.ok(order.lastCheckedAt > 0);

    recordOrderCheck(orderId, 'payment_hold', db);
    order = getSellerOrders(sellerId, db)[0];
    assert.equal(order.lastCheckStatus, 'payment_hold');
    assert.equal(order.checkCount, 2);
  });

  it('listOrdersDueForCheck chỉ trả order có cookie, chưa check gần đây', () => {
    // Just checked above → not due with a large min interval
    assert.equal(listOrdersDueForCheck(21600, 25, db).length, 0);
    // With 0s interval everything with a cookie is due again
    const due = listOrdersDueForCheck(0, 25, db);
    assert.equal(due.length, 1);
    assert.equal(due[0].id, orderId);
    assert.equal(due[0].cookie, 'NetflixId=abc; SecureNetflixId=def');
  });

  it('order không có cookie không nằm trong hàng đợi auto-check', () => {
    // New order without cookie
    const product = getProducts(true, db)[0];
    purchaseProduct(sellerId, product.id, { accountEmail: 'b2@example.com', accountPassword: 'x' }, db);
    const due = listOrdersDueForCheck(0, 25, db);
    // still only the one order that has a cookie
    assert.equal(due.length, 1);
    assert.equal(due[0].id, orderId);
  });
});
