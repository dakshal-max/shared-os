const express = require("express");
const path = require("path");
const store = require("./store");
const agents = require("./agents");
const tasks = require("./tasks");
const { getDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

// --- System Telemetry & Health ---

app.get("/api/system/stats", (_req, res) => {
  try {
    const db = getDb();
    const escrows = store.listEscrows();
    const allAgents = agents.listAgents();
    const allTasks = tasks.listTasks(100);

    const tvl = escrows
      .filter((e) => ["held", "failed_check", "disputed"].includes(e.status))
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const totalSettled = escrows
      .filter((e) => ["released", "resolved"].includes(e.status))
      .reduce((sum, e) => sum + ((e.resolution && e.resolution.amountPaid) || 0), 0);

    res.json({
      kernel: "omnIX v1.4.2-kernel",
      status: "ONLINE",
      uptimeSeconds: Math.floor(process.uptime()),
      tvl: Math.round(tvl * 100) / 100,
      totalSettled: Math.round(totalSettled * 100) / 100,
      totalEscrows: escrows.length,
      totalTasks: allTasks.length,
      totalAgents: allAgents.length,
      activeAgents: allAgents.filter((a) => a.status === "online" || a.status === "busy").length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Agents Registry (AgentCards) ---

app.get("/api/agents", (_req, res) => {
  try {
    res.json(agents.listAgents());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/agents/:id", (req, res) => {
  try {
    const agent = agents.getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/agents", (req, res) => {
  try {
    const agent = agents.registerAgent(req.body || {});
    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/agents/:id/status", (req, res) => {
  try {
    const updated = agents.updateAgentStatus(req.params.id, req.body?.status);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Tasks / Process Manager ---

app.get("/api/tasks", (_req, res) => {
  try {
    res.json(tasks.listTasks());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tasks/:id", (req, res) => {
  try {
    const task = tasks.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tasks", (req, res) => {
  try {
    const { title, payerAgentId, payeeAgentId, amount, spec, taskDescription } = req.body || {};
    if (!payerAgentId || !payeeAgentId || !amount) {
      return res.status(400).json({ error: "payerAgentId, payeeAgentId, and amount are required" });
    }
    const result = tasks.createTask({
      title,
      payerAgentId,
      payeeAgentId,
      amount,
      spec,
      taskDescription,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Autonomous A2A Simulation Endpoint
app.post("/api/simulate", (_req, res) => {
  try {
    const simulationResult = tasks.simulateInteraction();
    res.status(201).json(simulationResult);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Ledgerhand Escrows & Settlement ---

app.post("/api/escrow", (req, res) => {
  const { payerId, payeeId, amount, spec, taskDescription } = req.body || {};
  if (!payerId || !payeeId || !amount) {
    return res.status(400).json({ error: "payerId, payeeId, and amount are required" });
  }
  const record = store.createEscrow({ payerId, payeeId, amount, spec, taskDescription });
  res.status(201).json(record);
});

app.get("/api/escrow", (_req, res) => {
  res.json(store.listEscrows());
});

app.get("/api/escrow/:id", (req, res) => {
  const record = store.getEscrow(req.params.id);
  if (!record) return res.status(404).json({ error: "Escrow not found" });
  res.json(record);
});

app.post("/api/escrow/:id/submit", (req, res) => {
  try {
    const record = store.submitOutput(req.params.id, req.body?.output || {});
    if (!record) return res.status(404).json({ error: "Escrow not found" });
    res.json(record);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post("/api/escrow/:id/dispute", (req, res) => {
  try {
    const record = store.raiseDispute(req.params.id, req.body?.reason || "No reason given");
    if (!record) return res.status(404).json({ error: "Escrow not found" });
    res.json(record);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.get("/api/reputation", (_req, res) => {
  res.json(store.listReputations());
});

app.get("/api/reputation/:agentId", (req, res) => {
  res.json(store.getReputation(req.params.agentId));
});

app.listen(PORT, () => {
  console.log(`omnIX node listening on http://localhost:${PORT}`);
});
