# OkayDokki

OkayDokki is a human-in-the-loop AI code delivery agent.
Users submit tasks through IM (Telegram first), and the agent runs inside a restricted sandbox to generate a patch diff.
Any write action requires explicit approval before apply, and delivery is always through a Draft PR.
All actions are auditable by design with strict default safety boundaries (read-only source, no network, no direct push).

## MVP Stack

- IM: Telegram Bot API (webhook mode)
- Task store: SQLite
- Sandbox: Docker read-only mount + overlay write
- Agent adapter: CLI (Codex, Claude Code, etc.)
- PR creation: GitHub CLI (`gh pr create --draft`)
- Audit: JSONL event log

## Core Principles

- Human in the loop
- Default deny for writes
- PR-only delivery
- Full auditability
- Pluggable adapters

## Task State Machine

```text
CREATED
  -> WAIT_CLARIFY
  -> WAIT_APPROVE_WRITE
  -> RUNNING
  -> PR_CREATED
  -> COMPLETED
  -> FAILED
```

## Quick Start

1. Copy `.env.example` to `.env`.
2. Fill required values.
3. Prepare repository snapshots under `REPO_SNAPSHOT_ROOT`.
   Example for `repo=org/name`: `${REPO_SNAPSHOT_ROOT}/org/name`.
4. Install dependencies:

```bash
npm install
```

5. Initialize DB:

```bash
npm run db:init
```

6. Start service:

```bash
npm run dev
```

7. Run tests:

```bash
npm test
```

## MVP Scope in This Repository

- Task intake and persistence
- Explicit approval gate before write/run
- Missing snapshot guard (`WAIT_CLARIFY` before approval)
- Retry button to move `WAIT_CLARIFY` -> `WAIT_APPROVE_WRITE` after snapshot is ready
- Telegram callback flow (`Approve` / `Reject`)
- Auditable JSONL event stream
- Runner and adapter interfaces with safe defaults
- Draft PR creation hook
- Docker sandbox execution (`--network none`, read-only repo mount)

## Security Defaults

- No direct writes without approval
- Sandbox execution boundary (read-only + no-net)
- Restricted command surface for tests
- Draft PR only

## Sandbox Notes

- Agent command is configured by `AGENT_CLI_TEMPLATE`.
- Example template for Codex CLI:
  - `codex exec --task "$OKD_INTENT"`
- Template variables:
  - `{{task_id}}`
  - `{{intent}}`
  - `{{repo}}`
  - `{{branch}}`
  - `{{trigger_user}}`
- Runtime environment variables injected by runner:
  - `OKD_TASK_ID`
  - `OKD_REPO`
  - `OKD_BRANCH`
  - `OKD_TRIGGER_USER`
  - `OKD_INTENT`
  - `OKD_WORKDIR=/work`
  - `OKD_OUTDIR=/out`
- The agent command runs inside Docker against `/work`.
- Diff is generated automatically as `/out/patch.diff` by comparing `/repo` and `/work`.
- Optional metadata file: `/out/agent.meta.json` (flat string JSON object).
- Test command is enforced by `ALLOWED_TEST_COMMANDS`.
- Empty diff skips PR creation.
- Test failure marks task as `FAILED`.

## Internal API

- `POST /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `POST /api/v1/tasks/:taskId/actions`

Contracts:

- `docs/contracts/task-lifecycle.md`
- `docs/contracts/gateway-api.md`
- `docs/contracts/agent-adapter.md`
- `docs/contracts/audit-log.md`

## CI

Minimal CI is enabled via GitHub Actions:

- `npm ci`
- `npm run typecheck`
- `npm run build`

Workflow file:

- `.github/workflows/ci.yml`
