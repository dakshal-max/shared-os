const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Use an isolated temporary database for testing
const testDbPath = path.join(__dirname, "test-ledgerhand.db");
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}
process.env.DB_PATH = testDbPath;

const { getDb, closeDb } = require("../db");
const store = require("../store");

console.log("Starting Ledgerhand SQLite Store Tests...\n");

function runTests() {
  // Test 1: Create Escrow
  console.log("Test 1: createEscrow");
  const escrow1 = store.createEscrow({
    payerId: "agent-alice",
    payeeId: "agent-bob",
    amount: 100,
    spec: { requiredFields: ["summary", "report_url"] },
    taskDescription: "Generate Q3 Financial Summary",
  });

  assert.strictEqual(escrow1.payerId, "agent-alice");
  assert.strictEqual(escrow1.payeeId, "agent-bob");
  assert.strictEqual(escrow1.amount, 100);
  assert.strictEqual(escrow1.status, "held");
  assert.deepStrictEqual(escrow1.spec.requiredFields, ["summary", "report_url"]);
  assert.strictEqual(escrow1.history.length, 1);
  assert.strictEqual(escrow1.history[0].event, "escrow_opened");

  // Test 2: getEscrow
  console.log("Test 2: getEscrow");
  const fetched = store.getEscrow(escrow1.id);
  assert.strictEqual(fetched.id, escrow1.id);
  assert.strictEqual(fetched.payerId, "agent-alice");
  assert.strictEqual(fetched.status, "held");

  // Non-existent escrow should return null
  assert.strictEqual(store.getEscrow("esc_non_existent"), null);

  // Test 3: ensureReputations created on escrow open
  console.log("Test 3: Initial reputations");
  const repAlice = store.getReputation("agent-alice");
  assert.strictEqual(repAlice.agentId, "agent-alice");
  assert.strictEqual(repAlice.completed, 0);
  assert.strictEqual(repAlice.score, null);

  // Test 4: submitOutput - spec pass -> released
  console.log("Test 4: submitOutput with full spec match");
  const released = store.submitOutput(escrow1.id, {
    summary: "Here is the summary",
    report_url: "https://example.com/report.pdf",
    extraField: 123,
  });

  assert.strictEqual(released.status, "released");
  assert.strictEqual(released.resolution.outcome, "released");
  assert.strictEqual(released.resolution.amountPaid, 100);
  assert.strictEqual(released.history.length, 3); // opened, submitted, funds_released

  const repBobAfterRelease = store.getReputation("agent-bob");
  assert.strictEqual(repBobAfterRelease.completed, 1);
  assert.strictEqual(repBobAfterRelease.score, 100);

  // Test 5: submitOutput on non-held escrow should throw
  console.log("Test 5: submitOutput rejects non-held escrow");
  assert.throws(
    () => store.submitOutput(escrow1.id, { summary: "again" }),
    /cannot accept a new submission/
  );

  // Test 6: submitOutput with failed check -> failed_check
  console.log("Test 6: submitOutput with failed check");
  const escrow2 = store.createEscrow({
    payerId: "agent-alice",
    payeeId: "agent-charlie",
    amount: 50,
    spec: { requiredFields: ["fieldA", "fieldB"] },
    taskDescription: "Two-field task",
  });

  const failed = store.submitOutput(escrow2.id, {
    fieldA: "present",
    // fieldB missing!
  });

  assert.strictEqual(failed.status, "failed_check");
  assert.strictEqual(failed.output.fieldA, "present");

  // Test 7: raiseDispute with partial credit
  console.log("Test 7: raiseDispute with partial match");
  const disputed = store.raiseDispute(escrow2.id, "Missing fieldB");
  assert.strictEqual(disputed.status, "resolved");
  assert.strictEqual(disputed.resolution.outcome, "partial_release");
  assert.strictEqual(disputed.resolution.amountPaid, 25);
  assert.strictEqual(disputed.resolution.amountRefunded, 25);

  const repCharlie = store.getReputation("agent-charlie");
  assert.strictEqual(repCharlie.refunded, 1);
  // (0 + 1 * 0.5) / 1 = 50%
  assert.strictEqual(repCharlie.score, 50);

  // Test 8: raiseDispute with full refund (0 matched fields)
  console.log("Test 8: raiseDispute with full refund");
  const escrow3 = store.createEscrow({
    payerId: "agent-alice",
    payeeId: "agent-dave",
    amount: 80,
    spec: { requiredFields: ["required_one"] },
    taskDescription: "Unmatched task",
  });

  store.submitOutput(escrow3.id, { wrong_field: true });
  const refunded = store.raiseDispute(escrow3.id, "Completely wrong fields");
  assert.strictEqual(refunded.status, "resolved");
  assert.strictEqual(refunded.resolution.outcome, "full_refund");
  assert.strictEqual(refunded.resolution.amountPaid, 0);
  assert.strictEqual(refunded.resolution.amountRefunded, 80);

  const repDave = store.getReputation("agent-dave");
  assert.strictEqual(repDave.disputed, 1);
  assert.strictEqual(repDave.score, 0);

  // Test 9: listEscrows ordering
  console.log("Test 9: listEscrows ordering");
  const list = store.listEscrows();
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0].id, escrow3.id); // newest first

  // Test 10: listReputations leaderboard
  console.log("Test 10: listReputations leaderboard");
  const reps = store.listReputations();
  assert.strictEqual(reps[0].agentId, "agent-bob"); // score 100%
  assert.strictEqual(reps[0].score, 100);

  console.log("\nAll tests passed successfully!");
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
