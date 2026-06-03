const defaultDb = () => require('./database');

const migrations = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id         TEXT PRIMARY KEY,
          email      TEXT UNIQUE NOT NULL,
          password   TEXT NOT NULL,
          name       TEXT NOT NULL,
          plan       TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS users');
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
          id         TEXT NOT NULL,
          user_id    TEXT NOT NULL REFERENCES users(id),
          name       TEXT NOT NULL,
          color      TEXT NOT NULL,
          initial    TEXT NOT NULL,
          sort_order INTEGER DEFAULT 0,
          PRIMARY KEY (id, user_id)
        )
      `);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS profiles');
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL REFERENCES users(id),
          created_at INTEGER DEFAULT (unixepoch()),
          expires_at INTEGER NOT NULL
        )
      `);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS sessions');
    },
  },
  {
    version: 4,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS content (
          id          INTEGER PRIMARY KEY,
          title       TEXT NOT NULL,
          type        TEXT NOT NULL,
          seasons     INTEGER,
          duration    TEXT,
          genres      TEXT NOT NULL,
          rating      TEXT NOT NULL,
          maturity    TEXT NOT NULL,
          year        INTEGER NOT NULL,
          description TEXT NOT NULL,
          gradient    TEXT NOT NULL,
          accent      TEXT NOT NULL,
          rows        TEXT NOT NULL,
          featured    INTEGER DEFAULT 0,
          progress    INTEGER
        )
      `);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS content');
    },
  },
  {
    version: 5,
    up(db) {
      // Bảng keys: thay keyStore Map in-memory, dùng cho seller bán key + admin quản lý
      db.exec(`
        CREATE TABLE IF NOT EXISTS keys (
          key        TEXT PRIMARY KEY,
          email      TEXT NOT NULL,
          note       TEXT,
          used_count INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS keys');
    },
  },
  {
    version: 6,
    up(db) {
      // Tài khoản panel (admin + seller) — tách khỏi bảng users (Netflix demo)
      db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id             TEXT PRIMARY KEY,
          username       TEXT UNIQUE NOT NULL,
          email          TEXT UNIQUE NOT NULL,
          password       TEXT NOT NULL,
          role           TEXT NOT NULL,                    -- 'admin' | 'seller'
          status         TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'active' | 'rejected'
          email_verified INTEGER NOT NULL DEFAULT 0,
          verify_code    TEXT,
          verify_expires INTEGER,
          created_at     INTEGER DEFAULT (unixepoch())
        )
      `);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS accounts');
    },
  },
  {
    version: 7,
    up(db) {
      // Session panel (admin/seller) — UUID cookie tra ngược, tách khỏi sessions Netflix
      db.exec(`
        CREATE TABLE IF NOT EXISTS panel_sessions (
          session_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id),
          created_at INTEGER DEFAULT (unixepoch()),
          expires_at INTEGER NOT NULL
        )
      `);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS panel_sessions');
    },
  },
  {
    version: 8,
    up(db) {
      // Gắn key với seller tạo ra nó (NULL = key legacy hoặc do admin tạo)
      db.exec('ALTER TABLE keys ADD COLUMN seller_id TEXT REFERENCES accounts(id)');
    },
    down(db) {
      // SQLite cũ không hỗ trợ DROP COLUMN — rollback bỏ qua (không quan trọng)
    },
  },
  {
    version: 9,
    up(db) {
      // Quyền tối đa admin cấp cho seller (key ⊆ seller perms)
      db.exec('ALTER TABLE accounts ADD COLUMN perm_login INTEGER NOT NULL DEFAULT 1');
      db.exec('ALTER TABLE accounts ADD COLUMN perm_reset INTEGER NOT NULL DEFAULT 0');
      db.exec('ALTER TABLE accounts ADD COLUMN perm_family INTEGER NOT NULL DEFAULT 1');
      // Quyền từng key — seller chọn subset khi tạo/sửa
      db.exec('ALTER TABLE keys ADD COLUMN key_name TEXT');
      db.exec('ALTER TABLE keys ADD COLUMN expires_at INTEGER');
      db.exec('ALTER TABLE keys ADD COLUMN perm_login INTEGER NOT NULL DEFAULT 1');
      db.exec('ALTER TABLE keys ADD COLUMN perm_reset INTEGER NOT NULL DEFAULT 0');
      db.exec('ALTER TABLE keys ADD COLUMN perm_family INTEGER NOT NULL DEFAULT 0');
    },
    down(db) {},
  },
  {
    version: 10,
    up(db) {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN balance INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE accounts ADD COLUMN contact_name TEXT;
        ALTER TABLE accounts ADD COLUMN contact_type TEXT;
        ALTER TABLE accounts ADD COLUMN contact_info TEXT;
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id              TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          duration_label  TEXT,
          duration_days   INTEGER NOT NULL DEFAULT 30,
          price           INTEGER NOT NULL,
          warranty_note   TEXT,
          active          INTEGER NOT NULL DEFAULT 1,
          created_at      INTEGER DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS seller_orders (
          id               TEXT PRIMARY KEY,
          seller_id        TEXT NOT NULL REFERENCES accounts(id),
          product_id       TEXT REFERENCES products(id),
          product_name     TEXT NOT NULL,
          duration_label   TEXT,
          public_code      TEXT NOT NULL UNIQUE,
          account_email    TEXT NOT NULL,
          account_password TEXT,
          expires_at       INTEGER NOT NULL,
          renewal_count    INTEGER NOT NULL DEFAULT 0,
          via_email        INTEGER NOT NULL DEFAULT 1,
          perm_login       INTEGER NOT NULL DEFAULT 1,
          perm_reset       INTEGER NOT NULL DEFAULT 0,
          perm_family      INTEGER NOT NULL DEFAULT 0,
          note             TEXT,
          created_at       INTEGER DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_orders_seller ON seller_orders(seller_id);
        CREATE INDEX IF NOT EXISTS idx_orders_email ON seller_orders(account_email);
        CREATE TABLE IF NOT EXISTS order_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id    TEXT NOT NULL REFERENCES seller_orders(id),
          event_type  TEXT NOT NULL,
          detail      TEXT,
          created_at  INTEGER DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS transactions (
          id            TEXT PRIMARY KEY,
          account_id    TEXT NOT NULL REFERENCES accounts(id),
          type          TEXT NOT NULL,
          amount        INTEGER NOT NULL,
          balance_after INTEGER,
          ref_id        TEXT,
          description   TEXT,
          status        TEXT NOT NULL DEFAULT 'completed',
          created_at    INTEGER DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);
      `);
      db.exec('ALTER TABLE keys ADD COLUMN order_id TEXT REFERENCES seller_orders(id)');
    },
    down(db) {},
  },
];

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER DEFAULT (unixepoch())
    )
  `);
}

function getAppliedVersions(db) {
  return new Set(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all().map(r => r.version)
  );
}

function runMigrations(db) {
  const conn = db || defaultDb();
  ensureMigrationsTable(conn);
  const applied = getAppliedVersions(conn);

  const pending = migrations
    .filter(m => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    conn.exec('BEGIN');
    try {
      migration.up(conn);
      conn.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
      conn.exec('COMMIT');
    } catch (err) {
      conn.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version} failed: ${err.message}`);
    }
  }
}

function rollbackMigration(version, db) {
  const conn = db || defaultDb();
  const migration = migrations.find(m => m.version === version);
  if (!migration) throw new Error(`Migration ${version} not found`);

  conn.exec('BEGIN');
  try {
    migration.down(conn);
    conn.prepare('DELETE FROM schema_migrations WHERE version = ?').run(version);
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw new Error(`Rollback ${version} failed: ${err.message}`);
  }
}

module.exports = { runMigrations, rollbackMigration, migrations };
