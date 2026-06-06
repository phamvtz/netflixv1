'use strict';

const crypto = require('crypto');
const defaultDb = () => require('./database');
const { boolToInt, clampKeyPerms, getSellerMaxPerms } = require('./queries');

// Run fn inside a SQLite transaction (node:sqlite has no .transaction() helper).
// Commits when fn returns normally (including early returns), rolls back on throw.
function runInTransaction(conn, fn) {
  conn.exec('BEGIN');
  try {
    const result = fn();
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

function genOrderId() {
  return 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function genPublicCode() {
  return 'HK-' + crypto.randomBytes(4).toString('hex').toLowerCase().slice(0, 7);
}

function genTxnId() {
  return 'TXN-' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

function mapOrderRow(row, keyCount = 0) {
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  const expired = row.expires_at <= now;
  return {
    id: row.id,
    sellerId: row.seller_id,
    productId: row.product_id,
    productName: row.product_name,
    durationLabel: row.duration_label,
    publicCode: row.public_code,
    accountEmail: row.account_email,
    accountPassword: row.account_password,
    expiresAt: row.expires_at,
    renewalCount: row.renewal_count,
    viaEmail: row.via_email === 1,
    permLogin: row.perm_login === 1,
    permReset: row.perm_reset === 1,
    permFamily: row.perm_family === 1,
    note: row.note,
    createdAt: row.created_at,
    status: expired ? 'expired' : 'active',
    keyCount,
  };
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    durationLabel: row.duration_label,
    durationDays: row.duration_days,
    price: row.price,
    warrantyNote: row.warranty_note,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

function mapTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balance_after,
    refId: row.ref_id,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
  };
}

function logOrderEvent(orderId, eventType, detail, db) {
  const conn = db || defaultDb();
  conn.prepare(`
    INSERT INTO order_events (order_id, event_type, detail) VALUES (?, ?, ?)
  `).run(orderId, eventType, detail ?? null);
}

// ─── Products ─────────────────────────────────────────────────────────────────
function getProducts(activeOnly = true, db) {
  const conn = db || defaultDb();
  const sql = activeOnly
    ? 'SELECT * FROM products WHERE active = 1 ORDER BY price ASC'
    : 'SELECT * FROM products ORDER BY created_at DESC';
  return conn.prepare(sql).all().map(mapProduct);
}

function getProductById(id, db) {
  const conn = db || defaultDb();
  return mapProduct(conn.prepare('SELECT * FROM products WHERE id = ?').get(id));
}

function upsertProduct(p, db) {
  const conn = db || defaultDb();
  conn.prepare(`
    INSERT INTO products (id, name, duration_label, duration_days, price, warranty_note, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      duration_label = excluded.duration_label,
      duration_days = excluded.duration_days,
      price = excluded.price,
      warranty_note = excluded.warranty_note,
      active = excluded.active
  `).run(
    p.id, p.name, p.durationLabel, p.durationDays, p.price,
    p.warrantyNote ?? null, p.active !== false ? 1 : 0,
  );
  return getProductById(p.id, conn);
}

// ─── Balance & transactions ───────────────────────────────────────────────────
function getSellerBalance(sellerId, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT balance FROM accounts WHERE id = ?').get(sellerId);
  return row?.balance ?? 0;
}

function adjustBalance(accountId, delta, meta, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT balance FROM accounts WHERE id = ?').get(accountId);
  if (!row) return null;
  const next = row.balance + delta;
  if (next < 0) return { error: 'Insufficient balance' };
  conn.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(next, accountId);
  const txnId = genTxnId();
  conn.prepare(`
    INSERT INTO transactions (id, account_id, type, amount, balance_after, ref_id, description, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')
  `).run(
    txnId, accountId, meta.type, delta, next,
    meta.refId ?? null, meta.description ?? null,
  );
  return { balance: next, transactionId: txnId };
}

function getTransactions(accountId, limit = 50, db) {
  const conn = db || defaultDb();
  return conn.prepare(`
    SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(accountId, limit).map(mapTransaction);
}

function getTransactionSummary(accountId, db) {
  const conn = db || defaultDb();
  const rows = conn.prepare(`
    SELECT type, amount FROM transactions WHERE account_id = ? AND status = 'completed'
  `).all(accountId);
  let topup = 0;
  let spent = 0;
  let credit = 0;
  for (const r of rows) {
    if (r.amount > 0) {
      topup += r.amount;
      credit += r.amount;
    } else {
      spent += Math.abs(r.amount);
      credit += r.amount;
    }
  }
  return {
    totalTopup: topup,
    totalPlus: topup,
    totalMinus: spent,
    balance: getSellerBalance(accountId, conn),
  };
}

// ─── Orders ───────────────────────────────────────────────────────────────────
function countKeysForOrder(orderId, db) {
  const conn = db || defaultDb();
  return conn.prepare('SELECT COUNT(*) AS c FROM keys WHERE order_id = ?').get(orderId).c;
}

function createSellerOrder(opts, db) {
  const conn = db || defaultDb();
  const id = opts.id || genOrderId();
  const publicCode = opts.publicCode || genPublicCode();
  const now = Math.floor(Date.now() / 1000);
  let expiresAt = opts.expiresAt;
  if (!expiresAt && opts.durationDays) {
    expiresAt = now + opts.durationDays * 86400;
  }
  if (!expiresAt) expiresAt = now + 30 * 86400;

  const max = getSellerMaxPerms(opts.sellerId, conn);
  const perms = clampKeyPerms({
    permLogin: opts.permLogin,
    permReset: opts.permReset,
    permFamily: opts.permFamily,
  }, max);

  conn.prepare(`
    INSERT INTO seller_orders (
      id, seller_id, product_id, product_name, duration_label, public_code,
      account_email, account_password, expires_at, renewal_count, via_email,
      perm_login, perm_reset, perm_family, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    id, opts.sellerId, opts.productId ?? null, opts.productName,
    opts.durationLabel ?? null, publicCode,
    opts.accountEmail.trim().toLowerCase(),
    opts.accountPassword ?? null,
    expiresAt,
    boolToInt(opts.viaEmail !== false, 1),
    boolToInt(perms.permLogin, 1),
    boolToInt(perms.permReset, 0),
    boolToInt(perms.permFamily, 0),
    opts.note ?? null,
  );
  logOrderEvent(id, 'created', opts.productName, conn);
  return getSellerOrderById(id, opts.sellerId, conn);
}

function getSellerOrderById(orderId, sellerId, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT * FROM seller_orders WHERE id = ? AND seller_id = ?').get(orderId, sellerId);
  if (!row) return null;
  return mapOrderRow(row, countKeysForOrder(orderId, conn));
}

function getSellerOrders(sellerId, db) {
  const conn = db || defaultDb();
  const rows = conn.prepare(`
    SELECT * FROM seller_orders WHERE seller_id = ? ORDER BY created_at DESC
  `).all(sellerId);
  return rows.map((r) => mapOrderRow(r, countKeysForOrder(r.id, conn)));
}

function updateSellerOrder(orderId, sellerId, updates, db) {
  const conn = db || defaultDb();
  const existing = conn.prepare('SELECT * FROM seller_orders WHERE id = ? AND seller_id = ?').get(orderId, sellerId);
  if (!existing) return null;

  const max = getSellerMaxPerms(sellerId, conn);
  const sets = [];
  const vals = [];
  const o = updates || {};

  if (o.accountPassword !== undefined) {
    sets.push('account_password = ?');
    vals.push(o.accountPassword || null);
  }
  if (o.viaEmail !== undefined) {
    sets.push('via_email = ?');
    vals.push(boolToInt(o.viaEmail, 1));
  }
  if (o.note !== undefined) {
    sets.push('note = ?');
    vals.push(o.note || null);
  }
  if (o.permLogin !== undefined || o.permReset !== undefined || o.permFamily !== undefined) {
    const merged = clampKeyPerms({
      permLogin: o.permLogin !== undefined ? o.permLogin : existing.perm_login === 1,
      permReset: o.permReset !== undefined ? o.permReset : existing.perm_reset === 1,
      permFamily: o.permFamily !== undefined ? o.permFamily : existing.perm_family === 1,
    }, max);
    sets.push('perm_login = ?', 'perm_reset = ?', 'perm_family = ?');
    vals.push(boolToInt(merged.permLogin), boolToInt(merged.permReset), boolToInt(merged.permFamily));
  }

  if (sets.length) {
    vals.push(orderId, sellerId);
    conn.prepare(`UPDATE seller_orders SET ${sets.join(', ')} WHERE id = ? AND seller_id = ?`).run(...vals);
    if (o.permLogin !== undefined || o.permReset !== undefined || o.permFamily !== undefined) {
      const merged = getSellerOrderById(orderId, sellerId, conn);
      conn.prepare(`
        UPDATE keys SET perm_login = ?, perm_reset = ?, perm_family = ?
        WHERE order_id = ? AND seller_id = ?
      `).run(
        boolToInt(merged.permLogin), boolToInt(merged.permReset), boolToInt(merged.permFamily),
        orderId, sellerId,
      );
      logOrderEvent(orderId, 'perm_changed', JSON.stringify(merged), conn);
    }
    if (o.accountPassword !== undefined) logOrderEvent(orderId, 'password_changed', null, conn);
  }

  return getSellerOrderById(orderId, sellerId, conn);
}

function renewSellerOrder(orderId, sellerId, db) {
  const conn = db || defaultDb();
  const order = conn.prepare('SELECT * FROM seller_orders WHERE id = ? AND seller_id = ?').get(orderId, sellerId);
  if (!order) return null;
  const product = order.product_id
    ? conn.prepare('SELECT duration_days FROM products WHERE id = ?').get(order.product_id)
    : null;
  const days = product?.duration_days ?? 30;
  const base = Math.max(order.expires_at, Math.floor(Date.now() / 1000));
  const newExp = base + days * 86400;
  conn.prepare(`
    UPDATE seller_orders SET expires_at = ?, renewal_count = renewal_count + 1 WHERE id = ?
  `).run(newExp, orderId);
  logOrderEvent(orderId, 'renewed', `+${days} ngày`, conn);
  return getSellerOrderById(orderId, sellerId, conn);
}

function getOrderHistory(orderId, sellerId, db) {
  const conn = db || defaultDb();
  const ok = conn.prepare('SELECT id FROM seller_orders WHERE id = ? AND seller_id = ?').get(orderId, sellerId);
  if (!ok) return [];
  return conn.prepare(`
    SELECT id, order_id AS orderId, event_type AS eventType, detail, created_at AS createdAt
    FROM order_events WHERE order_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(orderId);
}

function getSellerEmails(sellerId, db) {
  const conn = db || defaultDb();
  return conn.prepare(`
    SELECT DISTINCT account_email AS email, COUNT(*) AS orderCount,
           MAX(expires_at) AS latestExpires
    FROM seller_orders WHERE seller_id = ?
    GROUP BY account_email ORDER BY latestExpires DESC
  `).all(sellerId).map((r) => ({
    email: r.email,
    orderCount: r.orderCount,
    latestExpires: r.latestExpires,
  }));
}

function getSellerDashboardStats(sellerId, db) {
  const conn = db || defaultDb();
  const orders = getSellerOrders(sellerId, conn);
  const now = Math.floor(Date.now() / 1000);
  const active = orders.filter((o) => o.expiresAt > now).length;
  const keys = conn.prepare('SELECT COUNT(*) AS c FROM keys WHERE seller_id = ?').get(sellerId).c;
  const keysUsed = conn.prepare('SELECT COUNT(*) AS c FROM keys WHERE seller_id = ? AND used_count > 0').get(sellerId).c;
  return {
    ordersTotal: orders.length,
    ordersActive: active,
    ordersExpired: orders.length - active,
    keysTotal: keys,
    keysUsed,
    keysUnused: keys - keysUsed,
    withFamily: orders.filter((o) => o.permFamily).length,
  };
}

function purchaseProduct(sellerId, productId, { accountEmail, accountPassword }, db) {
  const conn = db || defaultDb();
  const product = getProductById(productId, conn);
  if (!product || !product.active) return { error: 'Product not found' };
  if (!accountEmail?.includes('@')) return { error: 'Invalid account email' };

  const bal = adjustBalance(sellerId, -product.price, {
    type: 'purchase',
    refId: productId,
    description: `Mua ${product.name}`,
  }, conn);
  if (bal?.error) return bal;

  const order = createSellerOrder({
    sellerId,
    productId: product.id,
    productName: product.name,
    durationLabel: product.durationLabel,
    durationDays: product.durationDays,
    accountEmail,
    accountPassword: accountPassword || null,
    viaEmail: true,
    permLogin: true,
    permReset: false,
    permFamily: true,
  }, conn);

  return { order, balance: bal.balance };
}

function migrateOrphanKeysToOrders(db) {
  const conn = db || defaultDb();
  const orphans = conn.prepare(`
    SELECT * FROM keys WHERE order_id IS NULL AND seller_id IS NOT NULL
  `).all();
  for (const k of orphans) {
    const order = createSellerOrder({
      sellerId: k.seller_id,
      productName: 'Netflix · Temp mail (manual)',
      durationLabel: '—',
      durationDays: 30,
      accountEmail: k.email,
      accountPassword: null,
      expiresAt: k.expires_at,
      viaEmail: true,
      permLogin: k.perm_login === 1,
      permReset: k.perm_reset === 1,
      permFamily: k.perm_family === 1,
      note: k.note,
    }, conn);
    conn.prepare('UPDATE keys SET order_id = ? WHERE key = ?').run(order.id, k.key);
  }
  return orphans.length;
}

function updateSellerProfile(sellerId, { contactName, contactType, contactInfo }, db) {
  const conn = db || defaultDb();
  conn.prepare(`
    UPDATE accounts SET contact_name = ?, contact_type = ?, contact_info = ?
    WHERE id = ? AND role = 'seller'
  `).run(contactName ?? null, contactType ?? null, contactInfo ?? null, sellerId);
  return getSellerProfile(sellerId, conn);
}

function getSellerProfile(sellerId, db) {
  const conn = db || defaultDb();
  const row = conn.prepare(`
    SELECT id, username, email, balance, contact_name, contact_type, contact_info,
           perm_login, perm_reset, perm_family
    FROM accounts WHERE id = ? AND role = 'seller'
  `).get(sellerId);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    balance: row.balance,
    contactName: row.contact_name,
    contactType: row.contact_type,
    contactInfo: row.contact_info,
    permLogin: row.perm_login === 1,
    permReset: row.perm_reset === 1,
    permFamily: row.perm_family === 1,
  };
}

function adminCreateOrderForSeller(opts, db) {
  return createSellerOrder(opts, db);
}

function getOrderByPublicCode(publicCode, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT * FROM seller_orders WHERE public_code = ?').get(publicCode);
  return row ? mapOrderRow(row) : null;
}

function getOrderByEmailForInbox(email, db) {
  const conn = db || defaultDb();
  const row = conn.prepare(`
    SELECT * FROM seller_orders WHERE account_email = ? ORDER BY created_at DESC LIMIT 1
  `).get(email.trim().toLowerCase());
  return row ? mapOrderRow(row) : null;
}

module.exports = {
  genOrderId,
  genPublicCode,
  getProducts,
  getProductById,
  upsertProduct,
  getSellerBalance,
  adjustBalance,
  getTransactions,
  getTransactionSummary,
  createSellerOrder,
  getSellerOrderById,
  getSellerOrders,
  updateSellerOrder,
  renewSellerOrder,
  getOrderHistory,
  getSellerEmails,
  getSellerDashboardStats,
  purchaseProduct,
  migrateOrphanKeysToOrders,
  updateSellerProfile,
  getSellerProfile,
  adminCreateOrderForSeller,
  getOrderByEmailForInbox,
  logOrderEvent,
  recordDepositIntent,
  findDepositIntentByRef,
  listRecentDepositIntents,
  getDepositIntentsBySeller,
  listUnmatchedDepositIntents,
  assignDepositIntent,
};

// ── Deposit intents (bank webhook log) ─────────────────────────────
function mapDepositIntent(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    txRef: row.tx_ref,
    accountId: row.account_id,
    amount: row.amount,
    memo: row.memo,
    matchedUser: row.matched_user,
    status: row.status,
    transactionId: row.transaction_id,
    receivedAt: row.received_at,
    creditedAt: row.credited_at,
  };
}

function findDepositIntentByRef(provider, txRef, db) {
  const conn = db || defaultDb();
  return conn.prepare(
    'SELECT * FROM deposit_intents WHERE provider = ? AND tx_ref = ?',
  ).get(provider, String(txRef));
}

function listRecentDepositIntents(limit = 50, db) {
  const conn = db || defaultDb();
  return conn.prepare(
    'SELECT * FROM deposit_intents ORDER BY received_at DESC LIMIT ?',
  ).all(limit).map(mapDepositIntent);
}

// Deposit history for one seller — only intents credited to their account.
function getDepositIntentsBySeller(sellerId, limit = 50, db) {
  const conn = db || defaultDb();
  return conn.prepare(
    'SELECT * FROM deposit_intents WHERE account_id = ? ORDER BY received_at DESC LIMIT ?',
  ).all(sellerId, limit).map(mapDepositIntent);
}

// Deposits the system could not auto-match to a seller (admin review queue).
function listUnmatchedDepositIntents(limit = 100, db) {
  const conn = db || defaultDb();
  return conn.prepare(
    "SELECT * FROM deposit_intents WHERE status = 'unmatched' ORDER BY received_at DESC LIMIT ?",
  ).all(limit).map(mapDepositIntent);
}

// Manually assign an unmatched deposit to a seller and credit their balance.
// Idempotent guard: only acts on intents still in 'unmatched' status.
// Returns { intent, transactionId, balance } or { error }.
function assignDepositIntent(intentId, sellerId, db) {
  const conn = db || defaultDb();
  return runInTransaction(conn, () => {
    const row = conn.prepare('SELECT * FROM deposit_intents WHERE id = ?').get(intentId);
    if (!row) return { error: 'Deposit not found' };
    if (row.status !== 'unmatched') return { error: `Deposit already ${row.status}` };

    const seller = conn.prepare(
      "SELECT id, username FROM accounts WHERE id = ? AND role = 'seller' AND status = 'active'",
    ).get(sellerId);
    if (!seller) return { error: 'Seller not found or not active' };

    const credit = adjustBalance(sellerId, row.amount, {
      type: 'topup',
      refId: String(row.tx_ref),
      description: row.memo ? `Manual top-up · ${row.memo}` : 'Manual top-up (admin)',
    }, conn);
    if (!credit || credit.error) return { error: credit?.error || 'Credit failed' };

    conn.prepare(`
      UPDATE deposit_intents
         SET status = 'credited', account_id = ?, matched_user = ?,
             transaction_id = ?, credited_at = unixepoch()
       WHERE id = ?
    `).run(sellerId, seller.username, credit.transactionId, intentId);

    const updated = conn.prepare('SELECT * FROM deposit_intents WHERE id = ?').get(intentId);
    return {
      intent: mapDepositIntent(updated),
      transactionId: credit.transactionId,
      balance: credit.balance,
    };
  });
}

// Insert a fresh intent and atomically credit the seller if a username matched.
// Returns { intent, credited, transactionId, balance, error }.
function recordDepositIntent({ provider, txRef, amount, memo, matchedUser, accountId, payload }, db) {
  const conn = db || defaultDb();
  return runInTransaction(conn, () => {
    try {
      conn.prepare(`
        INSERT INTO deposit_intents (provider, tx_ref, account_id, amount, memo, matched_user, status, payload, received_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, unixepoch())
      `).run(provider, String(txRef), accountId || null, amount, memo || null, matchedUser || null, payload || null);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return { duplicate: true };
      }
      throw e;
    }
    if (!accountId) {
      conn.prepare("UPDATE deposit_intents SET status = 'unmatched' WHERE provider = ? AND tx_ref = ?")
        .run(provider, String(txRef));
      return { unmatched: true };
    }
    const credit = adjustBalance(accountId, amount, {
      type: 'topup',
      refId: String(txRef),
      description: memo ? `Auto top-up · ${memo}` : 'Auto top-up',
    }, conn);
    if (!credit || credit.error) {
      conn.prepare("UPDATE deposit_intents SET status = 'error' WHERE provider = ? AND tx_ref = ?")
        .run(provider, String(txRef));
      return { error: credit?.error || 'Credit failed' };
    }
    conn.prepare(`
      UPDATE deposit_intents
         SET status = 'credited', transaction_id = ?, credited_at = unixepoch()
       WHERE provider = ? AND tx_ref = ?
    `).run(credit.transactionId, provider, String(txRef));
    return { credited: true, transactionId: credit.transactionId, balance: credit.balance };
  });
}
