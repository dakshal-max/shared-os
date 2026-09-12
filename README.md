# Ledgerhand

An escrow + reputation microservice for agent-to-agent (A2A) task delegation on SharedOS.
One agent pays into escrow, the other delivers work against a machine-checkable spec, and
funds only move once the spec is satisfied — with every outcome logged to a portable
reputation record either agent can carry into its next transaction.

## What's in here

```
ledgerhand/
├── backend/                  Express API + SQLite persistent storage
│   ├── server.js              routes, and serves the frontend as static files
│   ├── db.js                  SQLite initialization, WAL mode & migrations
│   ├── store.js               database-backed escrow lifecycle, spec-check, arbiter & reputation
│   ├── test/
│   │   └── store.test.js      automated database test suite
│   ├── data/                  default directory for SQLite database (gitignored)
│   └── package.json
├── frontend/                  Static site (vanilla HTML/CSS/JS, no build step)
│   ├── index.html              landing page + interactive demo + live tables
│   ├── style.css
│   └── app.js                  talks to the real backend over fetch()
├── .gitignore
└── README.md
```

There's no separate frontend server — Express serves the static frontend files
directly, so one process runs the whole thing.

## Database & Persistence

Ledgerhand includes a persistent relational **SQLite** database (`backend/data/ledgerhand.db`) with:
- **Zero-setup**: Uses native Node.js built-in `node:sqlite` (Node >= 22.5.0) with fallback to `better-sqlite3`. No external database servers or daemons required.
- **WAL Mode**: Enabled for high-concurrency read/write transactions.
- **Relational Tables**:
  - `escrows`: Tracks ID, payer, payee, amount, spec, status, output, resolution, and timestamps.
  - `escrow_events`: Immutable audit trail for all escrow events (`escrow_opened`, `output_submitted`, `funds_released`, `check_failed`, `dispute_raised`, `dispute_resolved`).
  - `reputations`: Aggregated counters (`completed`, `disputed`, `refunded`) and computed reputation scores per agent.

### Environment Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | HTTP port for the Express API server. |
| `DB_PATH` | `./data/ledgerhand.db` | Path to the SQLite database file (`:memory:` can be used for ephemeral testing). |

## Run it

```bash
cd backend
npm install
npm start
```

Then open **http://localhost:4000** in a browser. The demo form on that page opens
real escrows against the persistent API — submit an output, dispute an outcome,
and watch the ledger and reputation tables update live with data persisted across server restarts.

## Run tests

```bash
cd backend
npm test
```

## API reference

| Method | Path                        | Body                                                  | Purpose                                      |
|--------|-----------------------------|--------------------------------------------------------|-----------------------------------------------|
| POST   | `/api/escrow`               | `{ payerId, payeeId, amount, spec: { requiredFields }, taskDescription }` | Open a new escrow, locking the payment.       |
| GET    | `/api/escrow`               | —                                                        | List all escrows, newest first.               |
| GET    | `/api/escrow/:id`           | —                                                        | Get one escrow's full state and history.      |
| POST   | `/api/escrow/:id/submit`    | `{ output: { ...fields } }`                              | Payee submits work; auto-checked against spec.|
| POST   | `/api/escrow/:id/dispute`   | `{ reason }`                                             | Escalate to the rules-based arbiter.          |
| GET    | `/api/reputation`           | —                                                        | Leaderboard of every agent's track record.     |
| GET    | `/api/reputation/:agentId`  | —                                                        | One agent's completed/disputed/refunded + score.|

## How settlement works

1. **Held** — payer opens an escrow with an amount and a spec (list of required output fields).
2. **Submit** — payee posts output. If every required field is present, funds **release** immediately.
   If some are missing, the escrow moves to `failed_check` and waits for a dispute.
3. **Dispute** — a lightweight rules-based arbiter re-checks the output:
   - all required fields matched → already released, nothing to arbitrate
   - some fields matched → **partial release**, proportional to the match
   - no fields matched (or no spec was attached at all) → **full refund**

## Notes for going further

- Add auth (signed requests per AgentCard) before this touches real funds.
- The spec check here is a flat "are these keys present" test — for production, validate
  against a real JSON Schema per task type.
- Reputation is currently per-process; wire it to `AgentCard` extensions so it's portable
  across every agent on SharedOS, not just this demo instance.
