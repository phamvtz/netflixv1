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
function createKey(key, email, note, sellerId, db) {
  const conn = db || defaultDb();
  conn.prepare('INSERT INTO keys (key, email, note, seller_id) VALUES (?, ?, ?, ?)').run(key, email, note ?? null, sellerId ?? null);
  return getKey(key, conn);
}

function getKey(key, db) {
  const conn = db || defaultDb();
  return conn.prepare('SELECT key, email, note, used_count AS usedCount, created_at AS createdAt, seller_id AS sellerId FROM keys WHERE key = ?').get(key) ?? null;
}

function resolveKeyEmail(key, db) {
  const conn = db || defaultDb();
  const row = conn.prepare('SELECT email FROM keys WHERE key = ?').get(key);
  if (!row) return null;
  conn.prepare('UPDATE keys SET used_count = used_count + 1 WHERE key = ?').run(key);
  return row.email;
}

function getAllKeys(db) {
  const conn = db || defaultDb();
  return conn.prepare(`
    SELECT k.key, k.email, k.note, k.used_count AS usedCount, k.created_at AS createdAt,
           k.seller_id AS sellerId, a.username AS sellerUsername
    FROM keys k
    LEFT JOIN accounts a ON a.id = k.seller_id
    ORDER BY k.created_at DESC
  `).all();
}

function getKeysBySeller(sellerId, db) {
  const conn = db || defaultDb();
  return conn.prepare('SELECT key, email, note, used_count AS usedCount, created_at AS createdAt FROM keys WHERE seller_id = ? ORDER BY created_at DESC').all(sellerId);
}

function deleteKey(key, db) {
  const conn = db || defaultDb();
  const info = conn.prepare('DELETE FROM keys WHERE key = ?').run(key);
  return info.changes > 0;
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
  return {
    id: row.id, username: row.username, email: row.email, role: row.role,
    status: row.status, emailVerified: row.email_verified === 1, createdAt: row.created_at,
  };
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
};
