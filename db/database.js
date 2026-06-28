const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// Singleton — every module shares a single connection
const dbPath = process.env.NETFLIX_DB_PATH || path.join(__dirname, '..', 'netflix.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

process.on('exit', () => {
  try { db.close(); } catch { /* ignore */ }
});

module.exports = db;
