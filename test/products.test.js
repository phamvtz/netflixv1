'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../db/migrate');
const { runSeed } = require('../db/seed');
const { upsertProduct, getProducts, getProductById } = require('../db/queries-orders');

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  runSeed(db);
  return db;
}

describe('Admin products CRUD', () => {
  let db;
  before(() => { db = createTestDb(); });

  it('tạo sản phẩm mới qua upsert', () => {
    const p = upsertProduct({
      id: 'prod_test_1', name: 'Test 1 tháng', durationLabel: '1 tháng',
      durationDays: 30, price: 99000, warrantyNote: 'BH full', active: true,
    }, db);
    assert.equal(p.name, 'Test 1 tháng');
    assert.equal(p.price, 99000);
    assert.equal(p.active, true);
  });

  it('sửa sản phẩm giữ nguyên id (không tạo bản ghi mới)', () => {
    const p = upsertProduct({
      id: 'prod_test_1', name: 'Test đổi tên', durationLabel: '1 tháng',
      durationDays: 30, price: 120000, warrantyNote: 'BH full', active: true,
    }, db);
    assert.equal(p.name, 'Test đổi tên');
    assert.equal(p.price, 120000);
    assert.equal(getProducts(false, db).filter((x) => x.id === 'prod_test_1').length, 1);
  });

  it('ẩn sản phẩm → biến mất khỏi activeOnly nhưng vẫn còn khi lấy tất cả', () => {
    upsertProduct({
      id: 'prod_test_1', name: 'Test đổi tên', durationLabel: '1 tháng',
      durationDays: 30, price: 120000, warrantyNote: 'BH full', active: false,
    }, db);
    assert.equal(getProductById('prod_test_1', db).active, false);
    assert.ok(!getProducts(true, db).map((x) => x.id).includes('prod_test_1'));
    assert.ok(getProducts(false, db).map((x) => x.id).includes('prod_test_1'));
  });
});
