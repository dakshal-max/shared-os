// Shared OS Process Manager & A2A Task Orchestrator
const { getDb, transaction } = require("./db");
const store = require("./store");

const SCENARIOS = [
  {
    title: "Sanitize & Deduplicate 50k Customer CSV Records",
    payerId: "agent-orchestrator-1",
    payeeId: "agent-cleaner-9",
    amount: 35,
    spec: { requiredFields: ["rows_cleaned", "schema_valid", "dedup_metrics"] },
    successOutput: { rows_cleaned: 50000, schema_valid: true, dedup_metrics: { removed: 1420 } },
    partialOutput: { rows_cleaned: 50000 },
  },
  {
    title: "Synthesize Rate Limiter Middleware with Unit Tests",
    payerId: "agent-orchestrator-1",
    payeeId: "agent-coder-x",
    amount: 60,
    spec: { requiredFields: ["code_patch", "ast_valid", "unit_tests_pass"] },
    successOutput: { code_patch: "export function rateLimiter...", ast_valid: true, unit_tests_pass: true },
    partialOutput: { code_patch: "export function...", ast_valid: true },
  },
  {
    title: "Generate Quantitative Volatility Report & Risk Score",
    payerId: "agent-orchestrator-1",
    payeeId: "agent-analyst-3",
    amount: 40,
    spec: { requiredFields: ["summary", "risk_score", "report_url"] },
    successOutput: { summary: "Sharpe ratio 2.1; beta 0.85", risk_score: 18, report_url: "https://reports.sharedos/q3.pdf" },
    partialOutput: { summary: "Preliminary risk estimates..." },
  },
  {
    title: "Audit Smart Contract Invariants & Machine Proof",
    payerId: "agent-analyst-3",
    payeeId: "agent-sentinel-0",
    amount: 55,
    spec: { requiredFields: ["proof_hash", "invariants_checked", "audit_passed"] },
    successOutput: { proof_hash: "0x89a1f...", invariants_checked: 14, audit_passed: true },
    partialOutput: { proof_hash: "0x89a1f..." },
  },
];

function formatTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    payerAgentId: row.payer_agent_id,
    payeeAgentId: row.payee_agent_id,
    escrowId: row.escrow_id,
    spec: row.spec ? JSON.parse(row.spec) : { requiredFields: [] },
    status: row.status,
    progress: Number(row.progress || 0),
    logs: row.logs ? JSON.parse(row.logs) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createTask({
  title,
  payerAgentId,
  payeeAgentId,
  amount,
  spec,
  taskDescription,
}) {
  return transaction((db) => {
    const taskId = "proc_" + Math.random().toString(36).slice(2, 9);
    const now = new Date().toISOString();
    const specObj = spec || { requiredFields: [] };
    const amt = Number(amount) || 20;

    // Create linked escrow
    const escrow = store.createEscrow({
      payerId: payerAgentId,
      payeeId: payeeAgentId,
      amount: amt,
      spec: specObj,
      taskDescription: taskDescription || title,
    });

    const initialLogs = [
      { at: now, level: "INFO", message: `Task initialized on SharedOS process bus.` },
      { at: now, level: "INFO", message: `Escrow ${escrow.id} opened: \$${amt} locked.` },
      { at: now, level: "INFO", message: `Payee ${payeeAgentId} notified via endpoint.` },
    ];

    db.prepare(
      `INSERT INTO tasks (id, title, payer_agent_id, payee_agent_id, escrow_id, spec, status, progress, logs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', 20, ?, ?, ?)`
    ).run(
      taskId,
      title || "Autonomous A2A Delegation Task",
      payerAgentId,
      payeeAgentId,
      escrow.id,
      JSON.stringify(specObj),
      JSON.stringify(initialLogs),
      now,
      now
    );

    return {
      task: getTask(taskId),
      escrow,
    };
  });
}

function getTask(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!row) return null;
  const task = formatTask(row);

  if (task.escrowId) {
    task.escrow = store.getEscrow(task.escrowId);
  }
  return task;
}

function listTasks(limit = 50) {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit);
  return rows.map(formatTask);
}

function appendTaskLog(taskId, level, message, newProgress, newStatus) {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) return null;

  const now = new Date().toISOString();
  const logs = task.logs || [];
  logs.push({ at: now, level, message });

  const progress = typeof newProgress === "number" ? newProgress : task.progress;
  const status = newStatus || task.status;

  db.prepare(
    `UPDATE tasks SET logs = ?, progress = ?, status = ?, updated_at = ? WHERE id = ?`
  ).run(JSON.stringify(logs), progress, status, now, taskId);

  return getTask(taskId);
}

// Simulates an end-to-end autonomous A2A delegation on Shared OS
function simulateInteraction() {
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const { task, escrow } = createTask({
    title: scenario.title,
    payerAgentId: scenario.payerId,
    payeeAgentId: scenario.payeeId,
    amount: scenario.amount,
    spec: scenario.spec,
    taskDescription: scenario.title,
  });

  // Roll outcome: 80% clean pass, 15% partial dispute, 5% full refund dispute
  const roll = Math.random();
  let outputPayload;
  let simulatedOutcome;

  if (roll < 0.8) {
    // Clean pass
    outputPayload = scenario.successOutput;
    appendTaskLog(task.id, "INFO", `Payee ${scenario.payeeId} compiled deliverable.`, 60, "running");
    store.submitOutput(escrow.id, outputPayload);
    appendTaskLog(
      task.id,
      "SUCCESS",
      `Deliverable submitted. Spec check PASSED. \$${escrow.amount} released to ${scenario.payeeId}.`,
      100,
      "completed"
    );
    simulatedOutcome = "released";
  } else if (roll < 0.95) {
    // Partial pass
    outputPayload = scenario.partialOutput;
    appendTaskLog(task.id, "WARN", `Payee ${scenario.payeeId} submitted partial deliverable.`, 60, "running");
    store.submitOutput(escrow.id, outputPayload);
    appendTaskLog(
      task.id,
      "WARN",
      `Spec check incomplete. Escrow moved to failed_check. Arbiter called.`,
      80,
      "disputed"
    );
    store.raiseDispute(escrow.id, "Automated check detected missing fields in submitted payload.");
    appendTaskLog(
      task.id,
      "INFO",
      `Sentinel Arbiter granted partial settlement. Escrow resolved.`,
      100,
      "completed"
    );
    simulatedOutcome = "partial_release";
  } else {
    // Complete mismatch
    outputPayload = { unspec_error: "Agent runtime failure during compilation." };
    appendTaskLog(task.id, "ERROR", `Deliverable malformed.`, 50, "running");
    store.submitOutput(escrow.id, outputPayload);
    store.raiseDispute(escrow.id, "Zero required spec keys delivered.");
    appendTaskLog(
      task.id,
      "ERROR",
      `Sentinel Arbiter issued full refund of \$${escrow.amount} to payer.`,
      100,
      "failed"
    );
    simulatedOutcome = "full_refund";
  }

  return {
    taskId: task.id,
    escrowId: escrow.id,
    title: scenario.title,
    outcome: simulatedOutcome,
    updatedTask: getTask(task.id),
    updatedEscrow: store.getEscrow(escrow.id),
  };
}

module.exports = {
  createTask,
  getTask,
  listTasks,
  appendTaskLog,
  simulateInteraction,
};
