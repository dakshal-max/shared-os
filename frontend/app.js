const $ = (sel) => document.querySelector(sel);

let activeEscrowId = null;

function fmtStatus(status) {
  return status.replace(/_/g, " ");
}

function statusClass(status) {
  return `status--${status}`;
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request to ${path} failed`);
  return data;
}

// --- hero live feed ---

function renderHeroFeed(escrows) {
  const rows = $("#hero-feed-rows");
  if (!escrows.length) {
    rows.innerHTML = `<p class="ledger-card__empty">Waiting for the first transaction…</p>`;
    return;
  }
  rows.innerHTML = escrows
    .slice(0, 8)
    .map(
      (e) => `
      <div class="ledger-row">
        <span class="ledger-row__parties">${e.payerId} → ${e.payeeId} · $${e.amount}</span>
        <span class="ledger-row__status ${statusClass(e.status)}">${fmtStatus(e.status)}</span>
      </div>`
    )
    .join("");
}

// --- ledger tables ---

function renderEscrowTable(escrows) {
  const tbody = $("#escrow-table tbody");
  tbody.innerHTML = escrows
    .map(
      (e) => `
      <tr>
        <td>${e.id}</td>
        <td>${e.payerId} → ${e.payeeId}</td>
        <td>$${e.amount}</td>
        <td class="${statusClass(e.status)}">${fmtStatus(e.status)}</td>
        <td>${new Date(e.createdAt).toLocaleTimeString()}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="5">No escrows opened yet.</td></tr>`;
}

function renderReputationTable(reps) {
  const tbody = $("#reputation-table tbody");
  tbody.innerHTML = reps
    .map(
      (r) => `
      <tr>
        <td>${r.agentId}</td>
        <td>${r.completed}</td>
        <td>${r.refunded}</td>
        <td>${r.disputed}</td>
        <td>${r.score === null ? "—" : r.score + "%"}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="5">No reputation history yet.</td></tr>`;
}

async function refreshAll() {
  try {
    const [escrows, reps] = await Promise.all([api("/escrow"), api("/reputation")]);
    renderHeroFeed(escrows);
    renderEscrowTable(escrows);
    renderReputationTable(reps);
  } catch (err) {
    console.error(err);
  }
}

// --- active escrow panel ---

function renderActiveEscrow(record) {
  activeEscrowId = record.id;
  const panel = $("#active-escrow");
  panel.hidden = false;
  $("#active-id").textContent = record.id;
  $("#active-status").textContent = fmtStatus(record.status);
  $("#active-status").className = `status-pill ${statusClass(record.status)}`;

  const spec = (record.spec.requiredFields || []).join(", ") || "no spec attached";
  $("#active-summary").textContent =
    `${record.payerId} owes ${record.payeeId} $${record.amount} for: "${record.taskDescription}". Required fields: ${spec}.`;

  if (record.resolution) {
    $("#active-summary").textContent +=
      ` Resolution: ${record.resolution.outcome.replace(/_/g, " ")} — $${record.resolution.amountPaid} paid` +
      (record.resolution.amountRefunded ? `, $${record.resolution.amountRefunded} refunded.` : ".");
  }

  $("#active-history").textContent = record.history
    .map((h) => `${h.at.split("T")[1].slice(0, 8)}  ${h.event}${h.reason ? " — " + h.reason : ""}`)
    .join("\n");
}

$("#escrow-form").addEventListener("submit", async (e) => {
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
    refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

$("#submit-output-btn").addEventListener("click", async () => {
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
    refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

$("#dispute-btn").addEventListener("click", async () => {
  if (!activeEscrowId) return;
  const reason = $("#dispute-reason").value || "No reason given";

  try {
    const record = await api(`/escrow/${activeEscrowId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    renderActiveEscrow(record);
    refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

refreshAll();
setInterval(refreshAll, 4000);
