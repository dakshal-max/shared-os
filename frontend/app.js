// omnIX Client Application
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// App State
let agentsList = [];
let escrowsList = [];
let reputationsList = [];
let tasksList = [];
let systemStats = {};
let activeEscrowId = null;
let autoSimulateTimer = null;
let currentEscrowFilter = "all";
let terminalHistory = [];
let historyIndex = -1;

// API Fetch Helper
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request to ${path} failed`);
  return data;
}

// Toast Notifications
function showToast(message, type = "info") {
  const container = $("#toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Formatting Helpers
function fmtStatus(status) {
  return (status || "").replace(/_/g, " ");
}

function statusClass(status) {
  return `status--${status}`;
}

function fmtMoney(amount) {
  return "$" + Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- Navigation & View Switcher ---

function switchTab(tabId) {
  $$(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabId);
  });
  $$(".tab-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `pane-${tabId}`);
  });

  if (tabId === "terminal") {
    setTimeout(() => $("#terminal-input")?.focus(), 50);
  }
}

$$(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

// --- Telemetry & System Stats ---

function renderTelemetry(stats) {
  if (!stats) return;
  systemStats = stats;

  $("#tele-tvl").textContent = fmtMoney(stats.tvl);
  $("#tele-settled").textContent = fmtMoney(stats.totalSettled);
  $("#tele-agents").textContent = `${stats.activeAgents}/${stats.totalAgents}`;
  $("#tele-escrows").textContent = stats.totalEscrows;

  $("#ov-tvl").textContent = fmtMoney(stats.tvl);
  $("#ov-settled").textContent = fmtMoney(stats.totalSettled);
  $("#ov-agents").textContent = `${stats.activeAgents} / ${stats.totalAgents}`;
  $("#ov-tasks").textContent = stats.totalTasks;
}

// --- Overview Live Stream ---

function renderHeroFeed(escrows) {
  const rows = $("#hero-feed-rows");
  if (!escrows || !escrows.length) {
    rows.innerHTML = `<p class="ledger-card__empty">Listening for agent interactions…</p>`;
    return;
  }

  rows.innerHTML = escrows
    .slice(0, 8)
    .map(
      (e) => `
      <div class="ledger-row" onclick="selectEscrow('${e.id}')" style="cursor: pointer;">
        <span class="ledger-row__parties">${e.payerId} → ${e.payeeId} · ${fmtMoney(e.amount)}</span>
        <span class="status-pill ${statusClass(e.status)}">${fmtStatus(e.status)}</span>
      </div>`
    )
    .join("");
}

// --- AgentCard Directory ---

function renderAgents(agents) {
  agentsList = agents || [];
  populateAgentSelects(agentsList);

  const container = $("#agents-container");
  const query = ($("#agent-search-input")?.value || "").toLowerCase().trim();

  const filtered = agentsList.filter((a) => {
    if (!query) return true;
    return (
      a.name.toLowerCase().includes(query) ||
      a.id.toLowerCase().includes(query) ||
      a.role.toLowerCase().includes(query) ||
      (a.capabilities || []).some((c) => c.toLowerCase().includes(query))
    );
  });

  if (!filtered.length) {
    container.innerHTML = `<p class="ledger-card__empty">No agents matching '${query}'.</p>`;
    return;
  }

  container.innerHTML = filtered
    .map((a) => {
      const rep = a.reputation || {};
      const scoreText = rep.score === null || rep.score === undefined ? "New" : `${rep.score}% Trust`;
      const initial = (a.name || a.id || "A").slice(0, 1).toUpperCase();

      return `
      <article class="agent-card">
        <div class="agent-card__header">
          <div class="agent-avatar" style="background: ${a.avatarColor || '#4C8B67'}">${initial}</div>
          <div class="agent-title">
            <h3 class="agent-name" title="${a.name}">${a.name}</h3>
            <p class="agent-role">${a.role}</p>
          </div>
          <span class="status-pill ${statusClass(a.status)}">${a.status}</span>
        </div>
        <p class="agent-card__desc">${a.description || 'Autonomous agent on the omnIX network.'}</p>
        <div class="agent-caps">
          ${(a.capabilities || []).map((c) => `<span class="cap-tag">${c}</span>`).join("")}
        </div>
        <div class="agent-card__footer">
          <span class="agent-rep-badge">★ ${scoreText} · ${rep.completed || 0} Done</span>
          <span class="agent-rate">${fmtMoney(a.rate)}/task</span>
          <button class="btn btn--sm btn--secondary" onclick="quickDelegateTo('${a.id}')">Delegate</button>
        </div>
      </article>`;
    })
    .join("");
}

$("#agent-search-input")?.addEventListener("input", () => renderAgents(agentsList));

function populateAgentSelects(agents) {
  const payerSelect = $("#form-payer-select");
  const payeeSelect = $("#form-payee-select");
  if (!payerSelect || !payeeSelect) return;

  const currentPayer = payerSelect.value || "agent-orchestrator-1";
  const currentPayee = payeeSelect.value || "agent-cleaner-9";

  const options = agents
    .map((a) => `<option value="${a.id}">${a.name} (${a.id})</option>`)
    .join("");

  payerSelect.innerHTML = options;
  payeeSelect.innerHTML = options;

  if (agents.some((a) => a.id === currentPayer)) payerSelect.value = currentPayer;
  if (agents.some((a) => a.id === currentPayee)) payeeSelect.value = currentPayee;
}

function quickDelegateTo(agentId) {
  switchTab("delegation");
  const payeeSelect = $("#form-payee-select");
  if (payeeSelect) payeeSelect.value = agentId;
  $("#form-desc")?.focus();
}

// --- Delegation Presets ---

const PRESETS = {
  cleaner: {
    payerId: "agent-orchestrator-1",
    payeeId: "agent-cleaner-9",
    amount: 35,
    taskDescription: "Clean and dedupe 50,000 customer records export",
    spec: "rows_cleaned, schema_valid, dedup_metrics",
  },
  coder: {
    payerId: "agent-orchestrator-1",
    payeeId: "agent-coder-x",
    amount: 60,
    taskDescription: "Synthesize Redis rate-limiter middleware with unit tests",
    spec: "code_patch, ast_valid, unit_tests_pass",
  },
  analyst: {
    payerId: "agent-orchestrator-1",
    payeeId: "agent-analyst-3",
    amount: 40,
    taskDescription: "Generate quantitative risk report and Sharpe ratio summary",
    spec: "summary, risk_score, report_url",
  },
  audit: {
    payerId: "agent-analyst-3",
    payeeId: "agent-sentinel-0",
    amount: 55,
    taskDescription: "Verify mathematical invariants and generate proof hash",
    spec: "proof_hash, invariants_checked, audit_passed",
  },
};

function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  if ($("#form-payer-select")) $("#form-payer-select").value = p.payerId;
  if ($("#form-payee-select")) $("#form-payee-select").value = p.payeeId;
  if ($("#form-amount")) $("#form-amount").value = p.amount;
  if ($("#form-desc")) $("#form-desc").value = p.taskDescription;
  if ($("#form-spec")) $("#form-spec").value = p.spec;
  showToast(`Preset '${key}' applied to delegation studio.`);
}

// --- Active Escrow Workbench ---

function renderActiveEscrow(record) {
  if (!record) {
    $("#active-escrow-empty").hidden = false;
    $("#active-escrow").hidden = true;
    return;
  }

  activeEscrowId = record.id;
  $("#active-escrow-empty").hidden = true;
  $("#active-escrow").hidden = false;

  $("#active-id").textContent = record.id;
  $("#active-status").textContent = fmtStatus(record.status);
  $("#active-status").className = `status-pill ${statusClass(record.status)}`;

  const specList = (record.spec?.requiredFields || []).join(", ") || "no spec attached";
  let summary = `${record.payerId} owes ${record.payeeId} ${fmtMoney(record.amount)} for: "${record.taskDescription}". Required fields: [${specList}].`;

  if (record.resolution) {
    summary += ` Resolution: ${fmtStatus(record.resolution.outcome)} — ${fmtMoney(record.resolution.amountPaid)} paid` +
      (record.resolution.amountRefunded ? `, ${fmtMoney(record.resolution.amountRefunded)} refunded.` : ".");
  }
  $("#active-summary").textContent = summary;

  // Pre-fill suggested submit fields
  if (record.status === "held" && record.spec?.requiredFields?.length) {
    $("#submitted-fields").value = record.spec.requiredFields.join(", ");
  }

  $("#active-history").textContent = (record.history || [])
    .map((h) => `${(h.at || "").split("T")[1]?.slice(0, 8) || "00:00:00"}  ${h.event}${h.reason ? " — " + h.reason : ""}`)
    .join("\n");
}

async function selectEscrow(id) {
  try {
    const record = await api(`/escrow/${id}`);
    renderActiveEscrow(record);
    switchTab("delegation");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// --- Escrow Form Submission ---

$("#escrow-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const requiredFields = String(form.get("requiredFields") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const record = await api("/escrow", {
      method: "POST",
      body: JSON.stringify({
        payerId: form.get("payerId"),
        payeeId: form.get("payeeId"),
        amount: Number(form.get("amount")),
        taskDescription: form.get("taskDescription"),
        spec: { requiredFields },
      }),
    });
    renderActiveEscrow(record);
    showToast(`Escrow ${record.id} opened successfully!`);
    refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Submit Deliverable
$("#submit-output-btn")?.addEventListener("click", async () => {
  if (!activeEscrowId) return;
  const fields = String($("#submitted-fields").value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const output = Object.fromEntries(fields.map((f) => [f, true]));

  try {
    const record = await api(`/escrow/${activeEscrowId}/submit`, {
      method: "POST",
      body: JSON.stringify({ output }),
    });
    renderActiveEscrow(record);
    showToast(`Deliverable submitted. Status: ${fmtStatus(record.status)}`);
    refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Escalate Dispute
$("#dispute-btn")?.addEventListener("click", async () => {
  if (!activeEscrowId) return;
  const reason = $("#dispute-reason").value || "Arbiter review requested";

  try {
    const record = await api(`/escrow/${activeEscrowId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    renderActiveEscrow(record);
    showToast(`Dispute resolved by Arbiter: ${fmtStatus(record.resolution?.outcome || record.status)}`);
    refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// --- Processes Table ---

function renderTasks(tasks) {
  tasksList = tasks || [];
  const tbody = $("#tasks-tbody");
  if (!tbody) return;

  if (!tasksList.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="ledger-card__empty">No active processes on omnIX task queue.</td></tr>`;
    return;
  }

  tbody.innerHTML = tasksList
    .map(
      (t) => `
      <tr>
        <td><strong>${t.id}</strong></td>
        <td>${t.title}</td>
        <td>${t.payerAgentId} → ${t.payeeAgentId}</td>
        <td><span class="status-pill ${statusClass(t.status)}">${fmtStatus(t.status)}</span></td>
        <td>
          <div class="proc-bar-wrap">
            <div class="proc-bar-inner" style="width: ${t.progress || 0}%"></div>
          </div>
          <span style="font-size: 0.72rem; color: var(--text-dim);">${t.progress || 0}%</span>
        </td>
        <td>${t.escrowId ? `<a href="javascript:selectEscrow('${t.escrowId}')" style="text-decoration: underline;">${t.escrowId}</a>` : '—'}</td>
        <td>
          <button class="btn btn--sm btn--ghost" onclick="viewTaskLogs('${t.id}')">Logs</button>
        </td>
      </tr>`
    )
    .join("");
}

$("#btn-refresh-tasks")?.addEventListener("click", async () => {
  try {
    const tasks = await api("/tasks");
    renderTasks(tasks);
    showToast("Processes refreshed.");
  } catch (err) {
    showToast(err.message, "error");
  }
});

async function viewTaskLogs(taskId) {
  try {
    const task = await api(`/tasks/${taskId}`);
    $("#task-logs-title").textContent = `Process Logs: ${task.id} (${task.title})`;
    $("#task-logs-meta").innerHTML = `
      <span>Payer: <strong>${task.payerAgentId}</strong></span> · 
      <span>Payee: <strong>${task.payeeAgentId}</strong></span> · 
      <span>Status: <strong class="${statusClass(task.status)}">${fmtStatus(task.status)}</strong></span>
    `;
    $("#task-logs-body").textContent = (task.logs || [])
      .map((l) => `[${(l.at || "").split("T")[1]?.slice(0, 8)}] [${l.level}] ${l.message}`)
      .join("\n") || "No logs recorded.";
    const m = $("#task-logs-modal");
    m.hidden = false;
    m.style.display = "flex";
  } catch (err) {
    showToast(err.message, "error");
  }
}

function closeTaskLogsModal() {
  const m = $("#task-logs-modal");
  m.hidden = true;
  m.style.display = "none";
}

// --- Ledger Explorer & Reputation Leaderboard ---

function renderEscrowTable(escrows) {
  escrowsList = escrows || [];
  const tbody = $("#escrow-table tbody");
  if (!tbody) return;

  const filtered = escrowsList.filter((e) => {
    if (currentEscrowFilter === "all") return true;
    return e.status === currentEscrowFilter;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="ledger-card__empty">No escrows found with status '${currentEscrowFilter}'.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (e) => `
      <tr>
        <td><strong>${e.id}</strong></td>
        <td>${e.payerId} → ${e.payeeId}</td>
        <td>${fmtMoney(e.amount)}</td>
        <td><span class="status-pill ${statusClass(e.status)}">${fmtStatus(e.status)}</span></td>
        <td>${new Date(e.createdAt).toLocaleTimeString()}</td>
        <td>
          <button class="btn btn--sm btn--ghost" onclick="selectEscrow('${e.id}')">Inspect</button>
        </td>
      </tr>`
    )
    .join("");
}

function renderReputationTable(reps) {
  reputationsList = reps || [];
  const tbody = $("#reputation-table tbody");
  if (!tbody) return;

  if (!reputationsList.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="ledger-card__empty">No reputation track records logged yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = reputationsList
    .map(
      (r) => `
      <tr>
        <td><strong>${r.agentId}</strong></td>
        <td>${r.completed}</td>
        <td>${r.refunded}</td>
        <td>${r.disputed}</td>
        <td>${r.score === null ? "—" : `<span style="color: var(--accent-light); font-weight: 600;">${r.score}%</span>`}</td>
      </tr>`
    )
    .join("");
}

// Filter buttons
$$("#escrow-filters .filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$("#escrow-filters .filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentEscrowFilter = btn.dataset.filter;
    renderEscrowTable(escrowsList);
  });
});

// --- Register Agent Modal ---

function openRegisterAgentModal() {
  const m = $("#register-agent-modal");
  m.hidden = false;
  m.style.display = "flex";
  $("#register-agent-form input[name='id']")?.focus();
}

function closeRegisterAgentModal() {
  const m = $("#register-agent-modal");
  m.hidden = true;
  m.style.display = "none";
}

$("#register-agent-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const newAgent = await api("/agents", {
      method: "POST",
      body: JSON.stringify({
        id: form.get("id"),
        name: form.get("name"),
        role: form.get("role"),
        rate: Number(form.get("rate")),
        capabilities: form.get("capabilities"),
        description: form.get("description"),
      }),
    });
    closeRegisterAgentModal();
    showToast(`AgentCard for '${newAgent.name}' registered to omnIX!`);
    refreshAll();
    switchTab("agents");
  } catch (err) {
    showToast(err.message, "error");
  }
});

// --- Simulation Controls ---

async function runSimulation() {
  try {
    const res = await api("/simulate", { method: "POST" });
    showToast(`Simulation: ${res.title} → ${fmtStatus(res.outcome)}`, "info");
    refreshAll();
    if (res.escrowId) {
      renderActiveEscrow(res.updatedEscrow);
    }
  } catch (err) {
    showToast(`Simulation error: ${err.message}`, "error");
  }
}

$("#btn-simulate-once")?.addEventListener("click", runSimulation);

$("#btn-simulate-auto")?.addEventListener("click", () => {
  const btn = $("#btn-simulate-auto");
  if (autoSimulateTimer) {
    clearInterval(autoSimulateTimer);
    autoSimulateTimer = null;
    btn.textContent = "Auto: OFF";
    btn.classList.remove("btn--primary");
    btn.classList.add("btn--ghost");
    showToast("Autonomous background simulation stopped.");
  } else {
    runSimulation();
    autoSimulateTimer = setInterval(runSimulation, 6000);
    btn.textContent = "Auto: ON";
    btn.classList.remove("btn--ghost");
    btn.classList.add("btn--primary");
    showToast("Autonomous background simulation started (6s tick).");
  }
});

// --- Interactive Shell / Terminal ---

const terminalOutput = $("#terminal-output");
const terminalInput = $("#terminal-input");

function printTerminal(text, type = "cmd-res") {
  const line = document.createElement("div");
  line.className = `terminal-line ${type}`;
  line.textContent = text;
  terminalOutput.appendChild(line);
  $("#terminal-body").scrollTop = $("#terminal-body").scrollHeight;
}

async function handleTerminalCommand(cmdStr) {
  const raw = cmdStr.trim();
  if (!raw) return;

  terminalHistory.push(raw);
  historyIndex = terminalHistory.length;

  printTerminal(`omnix@kernel:~$ ${raw}`, "cmd-echo");
  const [cmd, ...args] = raw.split(/\s+/);

  switch (cmd.toLowerCase()) {
    case "help":
      printTerminal(`Available omnIX commands:
  help                           Show this command reference
  sysinfo                        Display OS kernel health, TVL, and uptime
  agent ls                       List all registered agents
  agent info <id>                Inspect detailed AgentCard
  agent register <name> <role>   Register a new agent
  escrow ls                      List all escrow contracts
  escrow open <p1> <p2> <amt>    Open a new escrow
  task ls                        List active processes
  simulate                       Trigger an autonomous A2A delegation
  clear                          Clear terminal console screen`);
      break;

    case "sysinfo":
      try {
        const stats = await api("/system/stats");
        printTerminal(`omnIX Kernel Information:
  Kernel:        ${stats.kernel}
  Status:        ${stats.status}
  Uptime:        ${stats.uptimeSeconds} seconds
  TVL Locked:    ${fmtMoney(stats.tvl)}
  Total Settled: ${fmtMoney(stats.totalSettled)}
  Active Agents: ${stats.activeAgents} / ${stats.totalAgents}
  Escrows:       ${stats.totalEscrows}
  Tasks/Proc:    ${stats.totalTasks}`);
      } catch (err) {
        printTerminal(`Error fetching sysinfo: ${err.message}`, "cmd-err");
      }
      break;

    case "agent":
      if (args[0] === "ls" || args[0] === "list" || !args[0]) {
        const list = agentsList.length ? agentsList : await api("/agents");
        const lines = list.map((a) => `  ${a.id.padEnd(22)} | ${a.name.padEnd(24)} | \$${String(a.rate).padEnd(4)} | ${a.status}`);
        printTerminal(`ID                     | NAME                     | RATE  | STATUS\n` + lines.join("\n"));
      } else if (args[0] === "info") {
        if (!args[1]) {
          printTerminal("Usage: agent info <agent-id>", "cmd-err");
          break;
        }
        try {
          const agent = await api(`/agents/${args[1]}`);
          printTerminal(JSON.stringify(agent, null, 2));
        } catch (err) {
          printTerminal(`Error: ${err.message}`, "cmd-err");
        }
      } else if (args[0] === "register") {
        if (args.length < 3) {
          printTerminal("Usage: agent register <name> <role>", "cmd-err");
          break;
        }
        const name = args[1];
        const role = args.slice(2).join(" ");
        try {
          const res = await api("/agents", {
            method: "POST",
            body: JSON.stringify({ name, role, capabilities: ["custom_task"], rate: 25 }),
          });
          printTerminal(`Agent registered: ${res.name} (${res.id})`);
          refreshAll();
        } catch (err) {
          printTerminal(`Registration failed: ${err.message}`, "cmd-err");
        }
      } else {
        printTerminal(`Unknown agent subcommand '${args[0]}'. Try 'agent ls' or 'agent info <id>'`, "cmd-err");
      }
      break;

    case "escrow":
      if (args[0] === "ls" || args[0] === "list" || !args[0]) {
        const escrows = escrowsList.length ? escrowsList : await api("/escrow");
        const lines = escrows.slice(0, 15).map((e) => `  ${e.id.padEnd(14)} | ${e.payerId} -> ${e.payeeId} | \$${e.amount} | ${e.status}`);
        printTerminal(`ID             | PARTIES                     | AMT | STATUS\n` + lines.join("\n"));
      } else if (args[0] === "open") {
        if (args.length < 4) {
          printTerminal("Usage: escrow open <payerId> <payeeId> <amount> [required_fields...]", "cmd-err");
          break;
        }
        const [_, payerId, payeeId, amount, ...specFields] = args;
        try {
          const res = await api("/escrow", {
            method: "POST",
            body: JSON.stringify({
              payerId,
              payeeId,
              amount: Number(amount),
              spec: { requiredFields: specFields.length ? specFields : ["status"] },
              taskDescription: `CLI Delegation from ${payerId}`,
            }),
          });
          printTerminal(`Escrow opened: ${res.id} (\$${res.amount}) [${res.status}]`);
          refreshAll();
        } catch (err) {
          printTerminal(`Error opening escrow: ${err.message}`, "cmd-err");
        }
      } else {
        printTerminal(`Unknown escrow subcommand '${args[0]}'. Try 'escrow ls' or 'escrow open'`, "cmd-err");
      }
      break;

    case "task":
      if (args[0] === "ls" || args[0] === "list" || !args[0]) {
        const tasks = tasksList.length ? tasksList : await api("/tasks");
        const lines = tasks.slice(0, 15).map((t) => `  ${t.id.padEnd(14)} | ${t.title.slice(0, 30).padEnd(30)} | ${t.status.padEnd(10)} | ${t.progress}%`);
        printTerminal(`PROC ID        | TITLE                          | STATUS     | PROGRESS\n` + lines.join("\n"));
      }
      break;

    case "simulate":
    case "run":
      printTerminal("Dispatching autonomous A2A transaction across network...");
      try {
        const sim = await api("/simulate", { method: "POST" });
        printTerminal(`Simulation Complete:\n  Task:    ${sim.title}\n  Outcome: ${sim.outcome}\n  Escrow:  ${sim.escrowId}`);
        refreshAll();
      } catch (err) {
        printTerminal(`Simulation failed: ${err.message}`, "cmd-err");
      }
      break;

    case "clear":
      terminalOutput.innerHTML = "";
      break;

    default:
      printTerminal(`omnix: command not found: ${cmd}. Type 'help' for command list.`, "cmd-err");
  }
}

terminalInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = terminalInput.value;
    terminalInput.value = "";
    handleTerminalCommand(val);
  } else if (e.key === "ArrowUp") {
    if (terminalHistory.length && historyIndex > 0) {
      historyIndex--;
      terminalInput.value = terminalHistory[historyIndex];
    }
  } else if (e.key === "ArrowDown") {
    if (terminalHistory.length && historyIndex < terminalHistory.length - 1) {
      historyIndex++;
      terminalInput.value = terminalHistory[historyIndex];
    } else {
      historyIndex = terminalHistory.length;
      terminalInput.value = "";
    }
  }
});

// --- Master Refresh Loop ---

async function refreshAll() {
  try {
    const [stats, agents, escrows, reps, tasks] = await Promise.all([
      api("/system/stats").catch(() => null),
      api("/agents").catch(() => []),
      api("/escrow").catch(() => []),
      api("/reputation").catch(() => []),
      api("/tasks").catch(() => []),
    ]);

    if (stats) renderTelemetry(stats);
    if (agents.length) renderAgents(agents);
    if (escrows.length) {
      renderHeroFeed(escrows);
      renderEscrowTable(escrows);
    }
    if (reps.length) renderReputationTable(reps);
    if (tasks.length) renderTasks(tasks);

    // If active escrow is open, refresh it
    if (activeEscrowId) {
      const active = escrows.find((e) => e.id === activeEscrowId);
      if (active) renderActiveEscrow(active);
    }
  } catch (err) {
    console.error("omnIX refresh error:", err);
  }
}

// Global click outside modal to close
window.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-backdrop")) {
    closeRegisterAgentModal();
    closeTaskLogsModal();
  }
});

// Initialize
refreshAll();
setInterval(refreshAll, 4000);
