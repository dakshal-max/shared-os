// Shared OS Agent Registry & AgentCard Management
const { getDb, transaction } = require("./db");
const store = require("./store");

function formatAgent(row, rep) {
  if (!row) return null;
  const capabilities = row.capabilities ? JSON.parse(row.capabilities) : [];
  const repData = rep || { completed: 0, disputed: 0, refunded: 0, score: null };

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description || "",
    capabilities,
    rate: Number(row.rate),
    status: row.status,
    publicKey: row.public_key || "",
    endpoint: row.endpoint || `omnix://agents/${row.id}`,
    avatarColor: row.avatar_color || "#4C8B67",
    reputation: repData,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listAgents() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM agents ORDER BY name ASC").all();
  const reps = store.listReputations();
  const repMap = new Map(reps.map((r) => [r.agentId, r]));

  return rows.map((row) => formatAgent(row, repMap.get(row.id)));
}

function getAgent(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  if (!row) return null;

  const rep = store.getReputation(id);
  const agent = formatAgent(row, rep);

  // Attach recent escrows where agent was payer or payee
  const escrows = db
    .prepare(
      `SELECT id, payer_id, payee_id, amount, status, created_at
       FROM escrows
       WHERE payer_id = ? OR payee_id = ?
       ORDER BY created_at DESC
       LIMIT 10`
    )
    .all(id, id)
    .map((e) => ({
      id: e.id,
      payerId: e.payer_id,
      payeeId: e.payee_id,
      amount: Number(e.amount),
      status: e.status,
      createdAt: e.created_at,
    }));

  agent.recentEscrows = escrows;
  return agent;
}

function registerAgent({
  id,
  name,
  role,
  description,
  capabilities,
  rate,
  endpoint,
  avatarColor,
}) {
  return transaction((db) => {
    const agentId =
      id && id.trim()
        ? id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-")
        : `agent-${Math.random().toString(36).slice(2, 8)}`;

    const existing = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId);
    if (existing) {
      throw new Error(`Agent with ID '${agentId}' already exists`);
    }

    if (!name || !role) {
      throw new Error("Agent name and role are required");
    }

    const capsArray = Array.isArray(capabilities)
      ? capabilities
      : String(capabilities || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    const now = new Date().toISOString();
    const pubKey = `ed25519:${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
    const ep = endpoint || `omnix://agents/${agentId}`;
    const color = avatarColor || "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");

    db.prepare(
      `INSERT INTO agents (id, name, role, description, capabilities, rate, status, public_key, endpoint, avatar_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'online', ?, ?, ?, ?, ?)`
    ).run(
      agentId,
      name.trim(),
      role.trim(),
      description || "",
      JSON.stringify(capsArray),
      Number(rate) || 20,
      pubKey,
      ep,
      color,
      now,
      now
    );

    // Ensure reputation row exists
    db.prepare(
      `INSERT OR IGNORE INTO reputations (agent_id, completed, disputed, refunded, updated_at)
       VALUES (?, 0, 0, 0, ?)`
    ).run(agentId, now);

    return getAgent(agentId);
  });
}

function updateAgentStatus(id, status) {
  const db = getDb();
  const valid = ["online", "busy", "idle", "offline"];
  if (!valid.includes(status)) {
    throw new Error(`Invalid status '${status}'. Must be one of: ${valid.join(", ")}`);
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE agents SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  return getAgent(id);
}

module.exports = {
  listAgents,
  getAgent,
  registerAgent,
  updateAgentStatus,
};
