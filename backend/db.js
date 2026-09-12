const fs = require("fs");
const path = require("path");

let DatabaseSyncClass = null;

// Modern Node (>= 22.5.0) includes built-in node:sqlite
try {
  const nodeSqlite = require("node:sqlite");
  if (nodeSqlite && nodeSqlite.DatabaseSync) {
    DatabaseSyncClass = nodeSqlite.DatabaseSync;
  }
} catch {
  // node:sqlite not available
}

// Fallback to better-sqlite3 for older Node versions if installed
if (!DatabaseSyncClass) {
  try {
    const BetterSqlite = require("better-sqlite3");
    DatabaseSyncClass = BetterSqlite;
  } catch {
    // will throw on initDb if neither is present
  }
}

let dbInstance = null;

function getDbPath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "ledgerhand.db");
}

function initDb(customPath) {
  if (dbInstance) {
    return dbInstance;
  }

  if (!DatabaseSyncClass) {
    throw new Error(
      "No SQLite driver available. Please use Node.js >= 22.5.0 (for built-in node:sqlite) or install better-sqlite3."
    );
  }

  const dbPath = customPath || getDbPath();
  dbInstance = new DatabaseSyncClass(dbPath);

  if (dbPath !== ":memory:") {
    dbInstance.exec("PRAGMA journal_mode = WAL;");
  }
  dbInstance.exec("PRAGMA foreign_keys = ON;");

  migrate(dbInstance);
  return dbInstance;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS escrows (
      id TEXT PRIMARY KEY,
      payer_id TEXT NOT NULL,
      payee_id TEXT NOT NULL,
      amount REAL NOT NULL,
      spec TEXT NOT NULL,
      task_description TEXT,
      status TEXT NOT NULL,
      output TEXT,
      resolution TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_escrows_created_at ON escrows(created_at DESC);

    CREATE TABLE IF NOT EXISTS escrow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escrow_id TEXT NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      at TEXT NOT NULL,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_escrow_events_escrow_id ON escrow_events(escrow_id);

    CREATE TABLE IF NOT EXISTS reputations (
      agent_id TEXT PRIMARY KEY,
      completed INTEGER NOT NULL DEFAULT 0,
      disputed INTEGER NOT NULL DEFAULT 0,
      refunded INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}

function getDb() {
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

function closeDb() {
  if (dbInstance) {
    if (typeof dbInstance.close === "function") {
      dbInstance.close();
    }
    dbInstance = null;
  }
}

function transaction(fn) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn(db);
    db.exec("COMMIT;");
    return result;
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

module.exports = {
  initDb,
  getDb,
  closeDb,
  transaction,
};
