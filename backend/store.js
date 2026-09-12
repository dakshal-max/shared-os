// SQLite-backed persistent store for Ledgerhand.
// Persists escrows, audit log events, and agent reputations to SQLite.

const { getDb, transaction } = require("./db");

function ensureReputation(agentId) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO reputations (agent_id, completed, disputed, refunded, updated_at)
     VALUES (?, 0, 0, 0, ?)`
  ).run(agentId, now);

  const row = db.prepare(
    `SELECT agent_id AS agentId, completed, disputed, refunded FROM reputations WHERE agent_id = ?`
  ).get(agentId);

  return row;
}

function scoreFor(rep) {
  const total = rep.completed + rep.disputed + rep.refunded;
  if (total === 0) return null; // no history yet
  const raw = (rep.completed + rep.refunded * 0.5) / total;
  return Math.round(raw * 100);
}

function formatEscrowRow(row, events = []) {
  if (!row) return null;
  return {
    id: row.id,
    payerId: row.payer_id,
    payeeId: row.payee_id,
    amount: Number(row.amount),
    spec: row.spec ? JSON.parse(row.spec) : { requiredFields: [] },
    taskDescription: row.task_description || "",
    status: row.status,
    output: row.output ? JSON.parse(row.output) : null,
    resolution: row.resolution ? JSON.parse(row.resolution) : null,
    createdAt: row.created_at,
    history: events.map((e) => ({
      event: e.event,
      at: e.at,
      ...(e.details ? JSON.parse(e.details) : {}),
    })),
  };
}

function createEscrow({ payerId, payeeId, amount, spec, taskDescription }) {
  return transaction((db) => {
    const id = "esc_" + Math.random().toString(36).slice(2, 10);
    const now = new Date().toISOString();
    const specObj = spec || { requiredFields: [] };
    const specJson = JSON.stringify(specObj);
    const numAmount = Number(amount);
    const desc = taskDescription || "";
    const status = "held";

    db.prepare(
      `INSERT INTO escrows (id, payer_id, payee_id, amount, spec, task_description, status, output, resolution, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).run(id, payerId, payeeId, numAmount, specJson, desc, status, now, now);

    db.prepare(
      `INSERT INTO escrow_events (escrow_id, event, at, details)
       VALUES (?, 'escrow_opened', ?, NULL)`
    ).run(id, now);

    ensureReputation(payerId);
    ensureReputation(payeeId);

    return {
      id,
      payerId,
      payeeId,
      amount: numAmount,
      spec: specObj,
      taskDescription: desc,
      status,
      output: null,
      resolution: null,
      createdAt: now,
      history: [{ event: "escrow_opened", at: now }],
    };
  });
}

function getEscrow(id) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM escrows WHERE id = ?`).get(id);
  if (!row) return null;

  const events = db.prepare(
    `SELECT event, at, details FROM escrow_events WHERE escrow_id = ? ORDER BY id ASC`
  ).all(id);

  return formatEscrowRow(row, events);
}

function listEscrows() {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM escrows ORDER BY created_at DESC`).all();
  if (rows.length === 0) return [];

  const eventRows = db.prepare(
    `SELECT escrow_id, event, at, details FROM escrow_events ORDER BY id ASC`
  ).all();

  const eventMap = new Map();
  for (const e of eventRows) {
    if (!eventMap.has(e.escrow_id)) {
      eventMap.set(e.escrow_id, []);
    }
    eventMap.get(e.escrow_id).push(e);
  }

  return rows.map((row) => formatEscrowRow(row, eventMap.get(row.id) || []));
}

function logEvent(db, escrowId, event, extra = {}) {
  const at = new Date().toISOString();
  const details = Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;
  db.prepare(
    `INSERT INTO escrow_events (escrow_id, event, at, details) VALUES (?, ?, ?, ?)`
  ).run(escrowId, event, at, details);
}

// Checks how many of the spec's required fields are present in the submitted output.
function checkSpec(output, spec) {
  const required = (spec && spec.requiredFields) || [];
  if (required.length === 0) return { passed: true, matched: 0, total: 0 };
  const matched = required.filter((field) => output && Object.prototype.hasOwnProperty.call(output, field));
  return { passed: matched.length === required.length, matched: matched.length, total: required.length };
}

function submitOutput(id, output) {
  return transaction((db) => {
    const record = getEscrow(id);
    if (!record) return null;
    if (record.status !== "held") {
      throw new Error(`Escrow is '${record.status}', cannot accept a new submission`);
    }

    const check = checkSpec(output, record.spec);
    logEvent(db, id, "output_submitted", { check });

    const now = new Date().toISOString();
    const outputJson = JSON.stringify(output || {});

    if (check.passed) {
      const resolution = {
        outcome: "released",
        amountPaid: record.amount,
        reason: "Output matched the agreed spec.",
      };

      db.prepare(
        `UPDATE escrows
         SET status = 'released', output = ?, resolution = ?, updated_at = ?
         WHERE id = ?`
      ).run(outputJson, JSON.stringify(resolution), now, id);

      ensureReputation(record.payeeId);
      db.prepare(
        `UPDATE reputations SET completed = completed + 1, updated_at = ? WHERE agent_id = ?`
      ).run(now, record.payeeId);

      logEvent(db, id, "funds_released", { amount: record.amount });
    } else {
      db.prepare(
        `UPDATE escrows
         SET status = 'failed_check', output = ?, updated_at = ?
         WHERE id = ?`
      ).run(outputJson, now, id);

      logEvent(db, id, "check_failed", { check });
    }

    return getEscrow(id);
  });
}

// Simple rules-based arbiter: partial credit for partial spec match, otherwise a refund.
function raiseDispute(id, reason) {
  return transaction((db) => {
    const record = getEscrow(id);
    if (!record) return null;
    if (record.status !== "failed_check" && record.status !== "held") {
      throw new Error(`Escrow is '${record.status}', nothing left to dispute`);
    }

    const check = checkSpec(record.output || {}, record.spec);
    const now = new Date().toISOString();

    ensureReputation(record.payeeId);
    logEvent(db, id, "dispute_raised", { reason });

    let ruling;
    if (check.total > 0 && check.matched > 0 && check.matched < check.total) {
      const share = check.matched / check.total;
      const partial = Math.round(record.amount * share * 100) / 100;
      ruling = {
        outcome: "partial_release",
        amountPaid: partial,
        amountRefunded: Math.round((record.amount - partial) * 100) / 100,
        reason: `Arbiter found ${check.matched}/${check.total} required fields present; partial payment released.`,
      };

      db.prepare(
        `UPDATE reputations SET refunded = refunded + 1, updated_at = ? WHERE agent_id = ?`
      ).run(now, record.payeeId);
    } else {
      ruling = {
        outcome: "full_refund",
        amountPaid: 0,
        amountRefunded: record.amount,
        reason:
          check.total === 0
            ? "No machine-checkable spec was attached; defaulting to full refund pending manual review."
            : "Output matched none of the required fields.",
      };

      db.prepare(
        `UPDATE reputations SET disputed = disputed + 1, updated_at = ? WHERE agent_id = ?`
      ).run(now, record.payeeId);
    }

    db.prepare(
      `UPDATE escrows
       SET status = 'resolved', resolution = ?, updated_at = ?
       WHERE id = ?`
    ).run(JSON.stringify(ruling), now, id);

    logEvent(db, id, "dispute_resolved", ruling);

    return getEscrow(id);
  });
}

function getReputation(agentId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT agent_id AS agentId, completed, disputed, refunded FROM reputations WHERE agent_id = ?`
  ).get(agentId);

  const rep = row || { agentId, completed: 0, disputed: 0, refunded: 0 };
  return { ...rep, score: scoreFor(rep) };
}

function listReputations() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT agent_id AS agentId, completed, disputed, refunded FROM reputations`
  ).all();

  return rows
    .map((rep) => ({ ...rep, score: scoreFor(rep) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

module.exports = {
  createEscrow,
  getEscrow,
  listEscrows,
  submitOutput,
  raiseDispute,
  getReputation,
  listReputations,
  scoreFor,
};
