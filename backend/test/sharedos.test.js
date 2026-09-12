const assert = require("assert");
const fs = require("fs");
const path = require("path");

const testDbPath = path.join(__dirname, "test-sharedos.db");
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}
process.env.DB_PATH = testDbPath;

const { getDb, closeDb } = require("../db");
const agents = require("../agents");
const tasks = require("../tasks");
const store = require("../store");

console.log("Starting SharedOS Test Suite...\n");

function runTests() {
  // Test 1: Seeded standard agents
  console.log("Test 1: Standard agent seeding");
  const agentList = agents.listAgents();
  assert.ok(agentList.length >= 5, "Expected at least 5 standard agents");
  const nova = agents.getAgent("agent-orchestrator-1");
  assert.strictEqual(nova.name, "Nova Orchestrator");
  assert.ok(nova.capabilities.includes("task_planning"));
  assert.ok(nova.reputation.score !== undefined);

  // Test 2: Register custom agent
  console.log("Test 2: Register custom agent");
  const custom = agents.registerAgent({
    id: "agent-custom-99",
    name: "Custom Agent 99",
    role: "Deep Research",
    description: "Multi-hop web synthesizer",
    capabilities: ["web_search", "source_verification", "markdown_report"],
    rate: 30,
  });

  assert.strictEqual(custom.id, "agent-custom-99");
  assert.strictEqual(custom.name, "Custom Agent 99");
  assert.strictEqual(custom.status, "online");
  assert.deepStrictEqual(custom.capabilities, ["web_search", "source_verification", "markdown_report"]);

  // Test 3: Update agent status
  console.log("Test 3: Update agent status");
  const updated = agents.updateAgentStatus("agent-custom-99", "busy");
  assert.strictEqual(updated.status, "busy");

  // Test 4: Create task linked to escrow
  console.log("Test 4: Create task linked to escrow");
  const { task, escrow } = tasks.createTask({
    title: "Clean dataset batch #1",
    payerAgentId: "agent-orchestrator-1",
    payeeAgentId: "agent-cleaner-9",
    amount: 50,
    spec: { requiredFields: ["rows_cleaned", "schema_valid"] },
  });

  assert.ok(task.id.startsWith("proc_"));
  assert.strictEqual(task.status, "running");
  assert.strictEqual(task.escrowId, escrow.id);
  assert.strictEqual(escrow.amount, 50);
  assert.strictEqual(escrow.status, "held");

  // Test 5: List tasks
  console.log("Test 5: List tasks");
  const taskList = tasks.listTasks();
  assert.ok(taskList.length >= 1);
  assert.strictEqual(taskList[0].id, task.id);

  // Test 6: Simulate autonomous interaction
  console.log("Test 6: Simulate autonomous A2A interaction");
  const sim = tasks.simulateInteraction();
  assert.ok(sim.taskId);
  assert.ok(sim.escrowId);
  assert.ok(["released", "partial_release", "full_refund"].includes(sim.outcome));
  assert.ok(sim.updatedEscrow.status === "released" || sim.updatedEscrow.status === "resolved");

  // Test 7: System stats
  console.log("Test 7: System stats calculations");
  const allEscrows = store.listEscrows();
  const allAgents = agents.listAgents();
  const tvl = allEscrows
    .filter((e) => ["held", "failed_check", "disputed"].includes(e.status))
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  assert.ok(tvl >= 0);
  assert.ok(allAgents.length >= 6);

  console.log("\nAll SharedOS tests passed successfully!");
}

try {
  runTests();
} finally {
  closeDb();
  if (fs.existsSync(testDbPath)) {
    try {
      fs.unlinkSync(testDbPath);
      if (fs.existsSync(testDbPath + "-wal")) fs.unlinkSync(testDbPath + "-wal");
      if (fs.existsSync(testDbPath + "-shm")) fs.unlinkSync(testDbPath + "-shm");
    } catch {}
  }
}
