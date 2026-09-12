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
  seedStandardAgents(dbInstance);
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

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT,
      capabilities TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'online',
      public_key TEXT,
      endpoint TEXT,
      avatar_color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      payer_agent_id TEXT NOT NULL,
      payee_agent_id TEXT NOT NULL,
      escrow_id TEXT,
      spec TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      logs TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
  `);
}

function seedStandardAgents(db) {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM agents").get();
  if (countRow && countRow.count > 0) return;

  const now = new Date().toISOString();
  const seedAgents = [
    {
      id: "agent-orchestrator-1",
      name: "Nova Orchestrator",
      role: "Workflow Planner & Decomposition",
      description: "Decomposes complex human requests into machine-checkable tasks, manages escrows, and validates counterparty deliverables.",
      capabilities: JSON.stringify(["task_planning", "escrow_management", "a2a_dispatch", "audit"]),
      rate: 45,
      status: "online",
      public_key: "ed25519:9f8e21a4b6c3789012d45e67f89012ab",
      endpoint: "sharedos://agents/agent-orchestrator-1",
      avatar_color: "#4C8B67",
    },
    {
      id: "agent-cleaner-9",
      name: "TidyBot Data Engine",
      role: "Data Hygiene & Normalization",
      description: "High-throughput dataset sanitizer specializing in CSV/JSON deduplication, schema normalization, and integrity proofs.",
      capabilities: JSON.stringify(["rows_cleaned", "schema_valid", "dedup_metrics", "csv_processing"]),
      rate: 25,
      status: "online",
      public_key: "ed25519:3b7a81c2d9e456789012f345a67890cd",
      endpoint: "sharedos://agents/agent-cleaner-9",
      avatar_color: "#3B82F6",
    },
    {
      id: "agent-sentinel-0",
      name: "Sentinel Arbiter",
      role: "Spec Check & Dispute Arbitration",
      description: "Rules-based automated arbiter executing deterministic AST diffs and spec verification when agents dispute escrowed outcomes.",
      capabilities: JSON.stringify(["arbitration", "partial_credit", "spec_verification", "dispute_resolution"]),
      rate: 50,
      status: "online",
      public_key: "ed25519:1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
      endpoint: "sharedos://agents/agent-sentinel-0",
      avatar_color: "#B75239",
    },
    {
      id: "agent-analyst-3",
      name: "Cortex Quantitative",
      role: "Financial & Statistical Synthesis",
      description: "Performs quantitative modeling, summary generation, and risk assessment for agent-delegated operations.",
      capabilities: JSON.stringify(["summary", "risk_score", "report_url", "metrics_json"]),
      rate: 35,
      status: "idle",
      public_key: "ed25519:7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
      endpoint: "sharedos://agents/agent-analyst-3",
      avatar_color: "#8B5CF6",
    },
    {
      id: "agent-coder-x",
      name: "Vector Code Synthesizer",
      role: "Code Generation & AST Validation",
      description: "Produces deterministic code patches, validates AST syntax trees, and provides passing unit test suites against specifications.",
      capabilities: JSON.stringify(["code_patch", "ast_valid", "unit_tests_pass", "benchmark_ms"]),
      rate: 60,
      status: "online",
      public_key: "ed25519:5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f",
      endpoint: "sharedos://agents/agent-coder-x",
      avatar_color: "#EC4899",
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO agents (id, name, role, description, capabilities, rate, status, public_key, endpoint, avatar_color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const a of seedAgents) {
    stmt.run(
      a.id,
      a.name,
      a.role,
      a.description,
      a.capabilities,
      a.rate,
      a.status,
      a.public_key,
      a.endpoint,
      a.avatar_color,
      now,
      now
    );

    // Also seed baseline reputation
    db.prepare(
      `INSERT OR IGNORE INTO reputations (agent_id, completed, disputed, refunded, updated_at)
       VALUES (?, 5, 0, 1, ?)`
    ).run(a.id, now);
  }
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

let inTransaction = false;

function transaction(fn) {
  const db = getDb();
  if (inTransaction) {
    return fn(db);
  }
  inTransaction = true;
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn(db);
    db.exec("COMMIT;");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {}
    throw err;
  } finally {
    inTransaction = false;
  }
}

module.exports = {
  initDb,
  getDb,
  closeDb,
  transaction,
};
