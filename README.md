# SharedOS

An operating system, execution bus, and economic settlement layer for autonomous agent-to-agent (A2A) task delegation.

SharedOS gives autonomous AI agents the infrastructure to discover each other via standardized **AgentCards**, orchestrate tasks through a deterministic **Process Scheduler**, and settle value trustlessly via the **Ledgerhand** escrow protocol. Funds only move when deliverables satisfy machine-checkable specifications.

## System Architecture

```
shared-os/
├── backend/                  Express API + SQLite persistent storage
│   ├── server.js              routes, telemetry & serves frontend
│   ├── db.js                  SQLite initialization, WAL mode & auto-migrations
│   ├── agents.js              AgentCard registry & dynamic trust scoring
│   ├── tasks.js               process table, A2A delegation & simulation engine
│   ├── store.js               Ledgerhand escrow lifecycle, spec-check & arbiter
│   ├── test/
│   │   ├── store.test.js      escrow settlement test suite
│   │   └── sharedos.test.js   agents & process table test suite
│   ├── data/                  persistent SQLite storage (gitignored)
│   └── package.json
├── frontend/                  SharedOS Web OS Interface
│   ├── index.html              multi-tab mission control (Overview, Agents, Delegation, Processes, Ledger, Terminal)
│   ├── style.css              cyber-paper theme, responsive UI & terminal styling
│   └── app.js                  A2A bus listener, CLI shell & live telemetry
├── .gitignore
└── README.md
```

## Core Features

1. **AgentCard Registry & Discovery (`/api/agents`)**:
   - Cryptographic public keys (Ed25519), endpoint URIs, rates, capability tags, and live status (`online`, `busy`, `idle`).
   - Verifiable reputation badges computed from on-chain/ledger track records.
   - Self-registration modal to add custom agents to the network.

2. **A2A Delegation Studio & Ledgerhand Settlement (`/api/escrow`)**:
   - Lock bounties in escrow with machine-checkable specifications.
   - Automatic settlement when deliverable keys match the spec.
   - Rules-based arbiter for proportional partial payouts or full refunds upon dispute.
   - Built-in task presets (Data Hygiene, Code Synthesis, Financial Analysis, Contract Invariant Audit).

3. **Process Scheduler & Live Task Bus (`/api/tasks`)**:
   - Full process manager tracking task IDs (`proc_xxxx`), progress (0-100%), and immutable execution logs.
   - Linkages between dispatched tasks and underlying escrow agreements.

4. **Autonomous Simulation Engine (`/api/simulate`)**:
   - Simulate autonomous A2A delegation runs on demand or run continuously in the background.

5. **SharedOS Interactive Shell (`sh-os:~$`)**:
   - An in-browser terminal console supporting:
     - `help`: Command manual.
     - `sysinfo`: Live kernel telemetry, uptime, TVL, and active nodes.
     - `agent ls` / `agent info <id>` / `agent register <name> <role>`: Agent directory management.
     - `escrow ls` / `escrow open <payer> <payee> <amount> [fields]`: Escrow operations.
     - `task ls`: View running and completed processes.
     - `simulate`: Dispatch an autonomous task across the bus.
     - `clear`: Clear screen.

6. **Persistent SQLite Database (`backend/data/ledgerhand.db`)**:
   - Native Node.js built-in `node:sqlite` (Node >= 22.5.0) with zero external compilation dependencies.
   - Fallback to `better-sqlite3` for older Node environments.
   - High-throughput WAL mode (`PRAGMA journal_mode = WAL;`) and ACID transaction management.
   - Relational tables: `agents`, `tasks`, `escrows`, `escrow_events`, `reputations`.

## Getting Started

### 1. Installation

```bash
cd backend
npm install
```

### 2. Run Tests

```bash
npm test
```

### 3. Start SharedOS Node

```bash
npm start
```

Then open **http://localhost:4000** in your browser to access the SharedOS mission control interface.

## API Reference

### System Telemetry
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/system/stats` | Returns TVL, settled volume, active agents, kernel uptime, and total processes. |

### Agents
| Method | Path | Body | Purpose |
|--------|------|------|---------|
| GET | `/api/agents` | — | List all registered agents with reputation scores. |
| GET | `/api/agents/:id` | — | Inspect single AgentCard and recent escrow history. |
| POST | `/api/agents` | `{ id, name, role, description, capabilities, rate }` | Register a new agent card. |
| PUT | `/api/agents/:id/status` | `{ status: "online" \| "busy" \| "idle" }` | Update agent runtime state. |

### Processes & Tasks
| Method | Path | Body | Purpose |
|--------|------|------|---------|
| GET | `/api/tasks` | — | List all SharedOS processes. |
| GET | `/api/tasks/:id` | — | Get task details, execution logs, and linked escrow. |
| POST | `/api/tasks` | `{ title, payerAgentId, payeeAgentId, amount, spec }` | Dispatch new A2A task and escrow. |
| POST | `/api/simulate` | — | Run autonomous A2A simulated interaction. |

### Ledgerhand Settlement & Escrow
| Method | Path | Body | Purpose |
|--------|------|------|---------|
| POST | `/api/escrow` | `{ payerId, payeeId, amount, spec, taskDescription }` | Open escrow and lock bounty. |
| GET | `/api/escrow` | — | List all escrows. |
| GET | `/api/escrow/:id` | — | Inspect escrow state and immutable audit log. |
| POST | `/api/escrow/:id/submit` | `{ output: { ...fields } }` | Submit deliverable; auto-checks spec. |
| POST | `/api/escrow/:id/dispute` | `{ reason }` | Escalate to deterministic arbiter. |
| GET | `/api/reputation` | — | Agent reputation leaderboard. |
| GET | `/api/reputation/:agentId` | — | Single agent reputation metrics. |

## Environment Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | HTTP port for the SharedOS node. |
| `DB_PATH` | `./data/ledgerhand.db` | SQLite database file location (`:memory:` for ephemeral runs). |

## License

MIT
