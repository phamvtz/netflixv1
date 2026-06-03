const defaultDb = () => require('./database');

function mapUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, password: row.password, name: row.name, plan: row.plan };
}

function getUserByEmail(email, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT id, email, password, name, plan FROM users WHERE email = ?').get(email);
  return mapUser(row);
}

function getUserById(id, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT id, email, password, name, plan FROM users WHERE id = ?').get(id);
  return mapUser(row);
}

function getProfilesByUserId(userId, db) {
  const conn = db || defaultDb();
  return conn.prepare(`
    SELECT id, user_id AS userId, name, color, initial
    FROM profiles
    WHERE user_id = ?
    ORDER BY sort_order ASC
  `).all(userId);
}

function getProfileByIdAndUserId(profileId, userId, db) {
  const conn = db || defaultDb();
  return conn.prepare(`
    SELECT id, user_id AS userId, name, color, initial
    FROM profiles
    WHERE id = ? AND user_id = ?
  `).get(profileId, userId) ?? null;
}

function createSession(sessionId, userId, db) {
  const conn = db || defaultDb();
  const expiresAt = Math.floor(Date.now() / 1000) + 2592000;
  conn.prepare(`
    INSERT INTO sessions (session_id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, userId, expiresAt);
}

function getSession(sessionId, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at <= now) {
    conn.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
    return null;
  }
  return row;
}

function deleteSession(sessionId, db) {
  const conn = db || defaultDb();
  conn.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

function deleteExpiredSessions(db) {
  const conn = db || defaultDb();
  const now = Math.floor(Date.now() / 1000);
  conn.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
}

function getAllContent(db) {
  const conn = db || defaultDb();
  const rows = conn.prepare('SELECT * FROM content ORDER BY id ASC').all();
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    type: row.type,
    ...(row.seasons != null ? { seasons: row.seasons } : {}),
    ...(row.duration ? { duration: row.duration } : {}),
    genres: JSON.parse(row.genres),
    rating: row.rating,
    maturity: row.maturity,
    year: row.year,
    description: row.description,
    gradient: row.gradient,
    accent: row.accent,
    rows: JSON.parse(row.rows),
    ...(row.featured === 1 ? { featured: true } : {}),
    ...(row.progress != null ? { progress: row.progress } : {}),
  }));
}

// ─── Keys (seller bán key → email; admin quản lý) ─────────────────────────────
const KEY_SELECT = `
  k.key, k.email, k.note, k.key_name AS keyName, k.used_count AS usedCount,
  k.created_at AS createdAt, k.seller_id AS sellerId, k.expires_at AS expiresAt,
  k.perm_login AS permLogin, k.perm_reset AS permReset, k.perm_family AS permFamily,
  k.order_id AS orderId
`;

function mapKeyPerms(row) {
  if (!row) return null;
  return {
    permLogin: row.permLogin === 1,
    permReset: row.permReset === 1,
    permFamily: row.permFamily === 1,
  };
}

function mapKeyRow(row) {
  if (!row) return null;
  const p = mapKeyPerms(row);
  return {
    key: row.key,
    email: row.email,
    note: row.note,
    keyName: row.keyName,
    usedCount: row.usedCount,
    createdAt: row.createdAt,
    sellerId: row.sellerId,
    expiresAt: row.expiresAt,
    orderId: row.orderId,
    ...p,
    ...(row.sellerUsername != null ? { sellerUsername: row.sellerUsername } : {}),
  };
}

function normalizeKeyOpts(opts) {
  if (opts == null || typeof opts === 'string') return { note: opts ?? null };
  return opts;
}

function boolToInt(v, def = 0) {
  if (v === undefined || v === null) return def;
  return v ? 1 : 0;
}

function clampKeyPerms(requested, sellerMax) {
  const max = sellerMax || { permLogin: true, permReset: false, permFamily: true };
  return {
    permLogin: !!(requested?.permLogin && max.permLogin),
    permReset: !!(requested?.permReset && max.permReset),
    permFamily: !!(requested?.permFamily && max.permFamily),
  };
}

// Key ⊆ seller admin quyền ⊆ quyền đơn hàng (nếu có order)
function clampKeyPermsFull(requested, sellerMax, orderMax) {
  const s = clampKeyPerms(requested, sellerMax);
  if (!orderMax) return s;
  return {
    permLogin: s.permLogin && !!orderMax.permLogin,
    permReset: s.permReset && !!orderMax.permReset,
    permFamily: s.permFamily && !!orderMax.permFamily,
  };
}

function createKey(key, email, opts, sellerId, db) {
  const conn = db || defaultDb();
  const o = normalizeKeyOpts(opts);
  const perms = {
    permLogin: boolToInt(o.permLogin, 1),
    permReset: boolToInt(o.permReset, 0),
    permFamily: boolToInt(o.permFamily, 0),
  };
  conn.prepare(`
    INSERT INTO keys (key, email, note, seller_id, key_name, expires_at, perm_login, perm_reset, perm_family, order_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    key, email, o.note ?? null, sellerId ?? null,
    o.keyName ?? null, o.expiresAt ?? null,
    perms.permLogin, perms.permReset, perms.permFamily,
    o.orderId ?? null,
  );
  return getKey(key, conn);
}

function getKey(key, db) {
  const conn = db || defaultDb();
  const row = conn.prepare(`SELECT ${KEY_SELECT} FROM keys k WHERE k.key = ?`).get(key);
  return mapKeyRow(row);
}

function resolveKeyEmail(key, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT email FROM keys WHERE key = ?').get(key);
  if (!row) return null;
  conn.prepare('UPDATE keys SET used_count = used_count + 1 WHERE key = ?').run(key);
  return row.email;
}

function incrementKeyUsage(key, db) {
  const conn = db || defaultDb();
  const info = conn.prepare('UPDATE keys SET used_count = used_count + 1 WHERE key = ?').run(key);
  return info.changes > 0;
}

function updateKey(key, sellerId, updates, db) {
  const conn = db || defaultDb();
  const existing = conn.prepare('SELECT key FROM keys WHERE key = ? AND seller_id = ?').get(key, sellerId);
  if (!existing) return null;

  const sets = [];
  const vals = [];
  const o = updates || {};
  if (o.note !== undefined) { sets.push('note = ?'); vals.push(o.note || null); }
  if (o.keyName !== undefined) { sets.push('key_name = ?'); vals.push(o.keyName || null); }
  if (o.expiresAt !== undefined) { sets.push('expires_at = ?'); vals.push(o.expiresAt ?? null); }
  if (o.permLogin !== undefined) { sets.push('perm_login = ?'); vals.push(boolToInt(o.permLogin)); }
  if (o.permReset !== undefined) { sets.push('perm_reset = ?'); vals.push(boolToInt(o.permReset)); }
  if (o.permFamily !== undefined) { sets.push('perm_family = ?'); vals.push(boolToInt(o.permFamily)); }
  if (o.orderId !== undefined) { sets.push('order_id = ?'); vals.push(o.orderId ?? null); }
  if (!sets.length) return getKey(key, conn);

  vals.push(key, sellerId);
  conn.prepare(`UPDATE keys SET ${sets.join(', ')} WHERE key = ? AND seller_id = ?`).run(...vals);
  return getKey(key, conn);
}

function getAllKeys(db) {
  const conn = db || defaultDb();
  return conn.prepare(`
    SELECT ${KEY_SELECT}, a.username AS sellerUsername
    FROM keys k
    LEFT JOIN accounts a ON a.id = k.seller_id
    ORDER BY k.created_at DESC
  `).all().map(mapKeyRow);
}

function getKeysBySeller(sellerId, db) {
  const conn = db || defaultDb();
  return conn.prepare(`
    SELECT ${KEY_SELECT} FROM keys k WHERE k.seller_id = ? ORDER BY k.created_at DESC
  `).all(sellerId).map(mapKeyRow);
}

function getKeysBySellerEnriched(sellerId, db) {
  const conn = db || defaultDb();
  const rows = conn.prepare(`
    SELECT ${KEY_SELECT},
      o.product_name AS orderProductName,
      o.expires_at AS orderExpiresAt,
      o.perm_login AS orderPermLogin,
      o.perm_reset AS orderPermReset,
      o.perm_family AS orderPermFamily,
      o.account_email AS orderEmail
    FROM keys k
    LEFT JOIN seller_orders o ON o.id = k.order_id
    WHERE k.seller_id = ?
    ORDER BY k.created_at DESC
  `).all(sellerId);
  return rows.map((row) => {
    const k = mapKeyRow(row);
    k.orderProductName = row.orderProductName;
    k.orderExpiresAt = row.orderExpiresAt;
    k.orderPerms = row.orderPermLogin != null ? {
      permLogin: row.orderPermLogin === 1,
      permReset: row.orderPermReset === 1,
      permFamily: row.orderPermFamily === 1,
    } : null;
    return k;
  });
}

function deleteKey(key, db) {
  const conn = db || defaultDb();
  const info = conn.prepare('DELETE FROM keys WHERE key = ?').run(key);
  return info.changes > 0;
}

function deleteKeyForSeller(key, sellerId, db) {
  const conn = db || defaultDb();
  const info = conn.prepare('DELETE FROM keys WHERE key = ? AND seller_id = ?').run(key, sellerId);
  return info.changes > 0;
}

function syncKeyFromOrder(key, sellerId, db) {
  const conn = db || defaultDb();
  const k = getKey(key, conn);
  if (!k || k.sellerId !== sellerId || !k.orderId) return null;
  const order = conn.prepare('SELECT * FROM seller_orders WHERE id = ? AND seller_id = ?').get(k.orderId, sellerId);
  if (!order) return null;
  conn.prepare(`
    UPDATE keys SET
      perm_login = ?, perm_reset = ?, perm_family = ?,
      expires_at = ?, key_name = COALESCE(key_name, ?)
    WHERE key = ? AND seller_id = ?
  `).run(
    order.perm_login, order.perm_reset, order.perm_family,
    order.expires_at, order.product_name,
    key, sellerId,
  );
  return getKey(key, conn);
}

function getAdminStats(db) {
  const conn = db || defaultDb();
  const count = (sql) => conn.prepare(sql).get().c;
  return {
    users:        count('SELECT COUNT(*) AS c FROM users'),
    profiles:     count('SELECT COUNT(*) AS c FROM profiles'),
    sessions:     count('SELECT COUNT(*) AS c FROM sessions'),
    content:      count('SELECT COUNT(*) AS c FROM content'),
    keys:         count('SELECT COUNT(*) AS c FROM keys'),
    keysUsed:     count('SELECT COUNT(*) AS c FROM keys WHERE used_count > 0'),
    sellers:        count("SELECT COUNT(*) AS c FROM accounts WHERE role = 'seller'"),
    pendingSellers: count("SELECT COUNT(*) AS c FROM accounts WHERE role = 'seller' AND status = 'pending'"),
  };
}

function getAllUsers(db) {
  const conn = db || defaultDb();
  return conn.prepare('SELECT id, email, name, plan, created_at AS createdAt FROM users ORDER BY id ASC').all();
}

// ─── Accounts (admin + seller panel) ──────────────────────────────────────────
function mapAccount(row) {
  if (!row) return null;
  return {
    id: row.id, username: row.username, email: row.email, password: row.password,
    role: row.role, status: row.status, emailVerified: row.email_verified === 1,
    verifyCode: row.verify_code, verifyExpires: row.verify_expires, createdAt: row.created_at,
  };
}

// Bản rút gọn cho danh sách — không lộ password/verify_code
function mapAccountSafe(row) {
  if (!row) return null;
  const perms = row.perm_login != null
    ? { permLogin: row.perm_login === 1, permReset: row.perm_reset === 1, permFamily: row.perm_family === 1 }
    : { permLogin: true, permReset: false, permFamily: true };
  return {
    id: row.id, username: row.username, email: row.email, role: row.role,
    status: row.status, emailVerified: row.email_verified === 1, createdAt: row.created_at,
    ...perms,
  };
}

function getSellerMaxPerms(sellerId, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT perm_login, perm_reset, perm_family FROM accounts WHERE id = ?').get(sellerId);
  if (!row) return { permLogin: true, permReset: false, permFamily: true };
  return {
    permLogin: row.perm_login === 1,
    permReset: row.perm_reset === 1,
    permFamily: row.perm_family === 1,
  };
}

function setSellerPerms(sellerId, { permLogin, permReset, permFamily }, db) {
  const conn = db || defaultDb();
  const info = conn.prepare(`
    UPDATE accounts SET perm_login = ?, perm_reset = ?, perm_family = ?
    WHERE id = ? AND role = 'seller'
  `).run(boolToInt(permLogin, 1), boolToInt(permReset, 0), boolToInt(permFamily, 1), sellerId);
  return info.changes > 0;
}

function createAccount({ id, username, email, password, role, verifyCode, verifyExpires }, db) {
  const conn = db || defaultDb();
  conn.prepare(`
    INSERT INTO accounts (id, username, email, password, role, status, email_verified, verify_code, verify_expires)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(id, username, email, password, role, verifyCode ?? null, verifyExpires ?? null);
  return mapAccount(conn.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
}

function getAccountByUsername(username, db) {
  const conn = db || defaultDb();
  return mapAccount(conn.prepare('SELECT * FROM accounts WHERE username = ?').get(username));
}

function getAccountByEmail(email, db) {
  const conn = db || defaultDb();
  return mapAccount(conn.prepare('SELECT * FROM accounts WHERE email = ?').get(email));
}

function getAccountById(id, db) {
  const conn = db || defaultDb();
  return mapAccount(conn.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
}

function setVerifyCode(id, code, expires, db) {
  const conn = db || defaultDb();
  conn.prepare('UPDATE accounts SET verify_code = ?, verify_expires = ? WHERE id = ?').run(code, expires, id);
}

function markEmailVerified(id, db) {
  const conn = db || defaultDb();
  conn.prepare('UPDATE accounts SET email_verified = 1, verify_code = NULL, verify_expires = NULL WHERE id = ?').run(id);
}

function setAccountStatus(id, status, db) {
  const conn = db || defaultDb();
  const info = conn.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, id);
  return info.changes > 0;
}

function getSellers(db) {
  const conn = db || defaultDb();
  return conn.prepare("SELECT * FROM accounts WHERE role = 'seller' ORDER BY created_at DESC").all().map(mapAccountSafe);
}

function getPendingSellers(db) {
  const conn = db || defaultDb();
  return conn.prepare("SELECT * FROM accounts WHERE role = 'seller' AND status = 'pending' ORDER BY created_at DESC").all().map(mapAccountSafe);
}

// ─── Panel sessions (admin/seller) ────────────────────────────────────────────
function createPanelSession(sessionId, accountId, db) {
  const conn = db || defaultDb();
  const expiresAt = Math.floor(Date.now() / 1000) + 2592000; // 30 ngày
  conn.prepare('INSERT INTO panel_sessions (session_id, account_id, expires_at) VALUES (?, ?, ?)').run(sessionId, accountId, expiresAt);
}

function getPanelSession(sessionId, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT * FROM panel_sessions WHERE session_id = ?').get(sessionId);
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at <= now) {
    conn.prepare('DELETE FROM panel_sessions WHERE session_id = ?').run(sessionId);
    return null;
  }
  return row;
}

function deletePanelSession(sessionId, db) {
  const conn = db || defaultDb();
  conn.prepare('DELETE FROM panel_sessions WHERE session_id = ?').run(sessionId);
}

module.exports = {
  getUserByEmail,
  getUserById,
  getProfilesByUserId,
  getProfileByIdAndUserId,
  createSession,
  getSession,
  deleteSession,
  deleteExpiredSessions,
  getAllContent,
  createKey,
  getKey,
  resolveKeyEmail,
  incrementKeyUsage,
  updateKey,
  clampKeyPerms,
  clampKeyPermsFull,
  getSellerMaxPerms,
  getKeysBySellerEnriched,
  deleteKeyForSeller,
  syncKeyFromOrder,
  setSellerPerms,
  getAllKeys,
  getKeysBySeller,
  deleteKey,
  getAdminStats,
  getAllUsers,
  createAccount,
  getAccountByUsername,
  getAccountByEmail,
  getAccountById,
  setVerifyCode,
  markEmailVerified,
  setAccountStatus,
  getSellers,
  getPendingSellers,
  createPanelSession,
  getPanelSession,
  deletePanelSession,
  boolToInt,
};
