const defaultDb = () => require('./database');
const { content } = require('../data/content');
const { hashPassword } = require('../auth');

const USERS = [
  { id: 'u001', email: 'demo@netflix.com', password: 'demo123', name: 'Demo User', plan: 'Premium' },
  { id: 'u002', email: 'user@netflix.com', password: 'user123', name: 'Netflix User', plan: 'Standard' },
];

const PROFILES = [
  { id: 'p1', user_id: 'u001', name: 'User 1', color: '#E50914', initial: 'U1', sort_order: 0 },
  { id: 'p2', user_id: 'u001', name: 'User 2', color: '#0071EB', initial: 'U2', sort_order: 1 },
  { id: 'p3', user_id: 'u001', name: 'Kids', color: '#F5A623', initial: 'KD', sort_order: 2 },
  { id: 'p4', user_id: 'u001', name: 'Guest', color: '#54B83F', initial: 'GS', sort_order: 3 },
  { id: 'p1', user_id: 'u002', name: 'Main', color: '#E50914', initial: 'MN', sort_order: 0 },
  { id: 'p2', user_id: 'u002', name: 'Partner', color: '#9B59B6', initial: 'PT', sort_order: 1 },
];

function tableCount(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function seedUsers(db) {
  if (tableCount(db, 'users') > 0) return;
  const stmt = db.prepare(`
    INSERT INTO users (id, email, password, name, plan)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    // Hash mật khẩu trước khi lưu — không bao giờ lưu plaintext
    for (const u of USERS) stmt.run(u.id, u.email, hashPassword(u.password), u.name, u.plan);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedProfiles(db) {
  if (tableCount(db, 'profiles') > 0) return;
  const stmt = db.prepare(`
    INSERT INTO profiles (id, user_id, name, color, initial, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const p of PROFILES) {
      stmt.run(p.id, p.user_id, p.name, p.color, p.initial, p.sort_order);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedContent(db) {
  if (tableCount(db, 'content') > 0) return;
  const stmt = db.prepare(`
    INSERT INTO content (
      id, title, type, seasons, duration, genres, rating, maturity,
      year, description, gradient, accent, rows, featured, progress
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const item of content) {
      stmt.run(
        item.id,
        item.title,
        item.type,
        item.seasons ?? null,
        item.duration ?? null,
        JSON.stringify(item.genres),
        item.rating,
        item.maturity,
        item.year,
        item.description,
        item.gradient,
        item.accent,
        JSON.stringify(item.rows),
        item.featured ? 1 : 0,
        item.progress ?? null,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedAccounts(db) {
  if (tableCount(db, 'accounts') > 0) return;
  // Tài khoản admin mặc định — admin / Admin2026 (active, đã xác minh)
  db.prepare(`
    INSERT INTO accounts (id, username, email, password, role, status, email_verified)
    VALUES (?, ?, ?, ?, 'admin', 'active', 1)
  `).run('acc_admin', 'admin', 'hcjx125@gmail.com', hashPassword('Admin2026'));
}

function runSeed(db) {
  const conn = db || defaultDb();
  seedUsers(conn);
  seedProfiles(conn);
  seedContent(conn);
  seedAccounts(conn);
}

module.exports = { runSeed };
