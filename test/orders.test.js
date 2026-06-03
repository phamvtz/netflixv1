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
  renewSellerOrder,
  getSellerDashboardStats,
} = require('../db/queries-orders');
const { createKey, getKey } = require('../db/queries');

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  runSeed(db);
  return db;
}

describe('Seller orders & store', () => {
  let db;
  const sellerId = 'sel_ord_test';

  before(() => {
    db = createTestDb();
    createAccount({
      id: sellerId,
      username: 'sellerord',
      email: 'ord@test.local',
      password: hashPassword('pass123'),
      role: 'seller',
    }, db);
    setAccountStatus(sellerId, 'active', db);
    adjustBalance(sellerId, 500000, { type: 'topup', description: 'Test' }, db);
  });

  it('có sản phẩm seed', () => {
    const products = getProducts(true, db);
    assert.ok(products.length >= 1);
    assert.ok(products[0].price > 0);
  });

  it('mua sản phẩm → tạo đơn + trừ số dư', () => {
    const product = getProducts(true, db)[0];
    const r = purchaseProduct(sellerId, product.id, {
      accountEmail: 'buyer@tinyhost.shop',
      accountPassword: 'pass999',
    }, db);
    assert.ok(r.order);
    assert.equal(r.order.accountEmail, 'buyer@tinyhost.shop');
    assert.equal(r.order.accountPassword, 'pass999');
    assert.equal(r.order.status, 'active');
    assert.ok(r.balance < 500000);

    const orders = getSellerOrders(sellerId, db);
    assert.equal(orders.length, 1);
  });

  it('cập nhật đơn: via_email, quyền, mật khẩu', () => {
    const order = getSellerOrders(sellerId, db)[0];
    const updated = updateSellerOrder(order.id, sellerId, {
      viaEmail: false,
      permFamily: true,
      accountPassword: 'newpass',
    }, db);
    assert.equal(updated.viaEmail, false);
    assert.equal(updated.permFamily, true);
    assert.equal(updated.accountPassword, 'newpass');
  });

  it('gia hạn đơn tăng renewal_count', () => {
    const order = getSellerOrders(sellerId, db)[0];
    const renewed = renewSellerOrder(order.id, sellerId, db);
    assert.equal(renewed.renewalCount, 1);
    assert.ok(renewed.expiresAt >= order.expiresAt);
  });

  it('key gắn order_id', () => {
    const order = getSellerOrders(sellerId, db)[0];
    createKey('SK-ORD-LINK', order.accountEmail, {
      orderId: order.id,
      permLogin: true,
      permFamily: true,
    }, sellerId, db);
    const k = getKey('SK-ORD-LINK', db);
    assert.equal(k.orderId, order.id);
  });

  it('dashboard stats', () => {
    const s = getSellerDashboardStats(sellerId, db);
    assert.ok(s.ordersTotal >= 1);
    assert.ok(s.keysTotal >= 1);
  });
});
