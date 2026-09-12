const express = require("express");
const path = require("path");
const store = require("./store");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

// --- API ---

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
  console.log(`Ledgerhand backend listening on http://localhost:${PORT}`);
});
