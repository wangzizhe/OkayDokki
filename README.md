# OkayDokki

<p align="center">
  <a href="https://github.com/wangzizhe/OkayDokki/actions/workflows/ci.yml" style="text-decoration:none;"><img src="https://github.com/wangzizhe/OkayDokki/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>&nbsp;
  <a href="LICENSE" style="text-decoration:none;"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License" /></a>&nbsp;
  <a href="https://nodejs.org/" style="text-decoration:none;"><img src="https://img.shields.io/badge/node-%3E%3D22-339933.svg" alt="Node >= 22" /></a>
</p>
<strong>Text your agent when inspiration strikes, anywhere, anytime.</strong>

OkayDokki turns a moment of idea into a safe, reviewable engineering action.
It proposes a plan, waits for approval, and delivers only via Draft PRs.

OkayDokki closes the **idea-to-execution gap**.

---

Message your AI agent from anywhere, anytime.

![OkayDokki ChatBot](docs/assets/chat_full.png)

It works in a sandbox and opens a Draft PR. You approve before merge.

![OkayDokki DraftPR](docs/assets/draftPR.png)

## Our Philosophy: Safety > Autonomy

* OkayDokki does not run your repository code on our servers.
  Execution stays in your environment and within your trust boundary.
* Nothing executes without your explicit approval.
  Draft PRs are contracts, not silent outcomes.
* Human-in-the-loop is the default, not an optional mode.
  Every change is reviewable, replayable, and auditable.
* We optimize for decision quality and control, not maximum autonomy.
  If you want fully autonomous execution, this is not that product.

See full design philosophy: `docs/philosophy.md`

## Why OkayDokki

| Dimension         | OkayDokki                  | Typical Coding Agents      |
| ----------------- | -------------------------- | -------------------------- |
| Primary interface | IM-first (Telegram)        | IDE/web-first              |
| Default mode      | Plan-first                 | Execute-first              |
| Execution gate    | Explicit approval required | Often policy/implicit      |
| Runtime boundary  | Your environment           | Often platform-managed     |
| Product goal      | Decision quality + control | Execution speed + autonomy |

See full positioning: `docs/positioning.md`

## How OkayDokki Works

```mermaid
sequenceDiagram
  participant U as User (IM)
  participant C as Control Plane (OkayDokki)
  participant R as Runner (Local/Sandbox)
  participant G as GitHub

  U->>C: /task one-line intent
  C-->>U: Proposal + risk summary
  U->>C: Approve write
  C->>R: Apply changes + run tests
  R->>G: Create Draft PR (only delivery artifact)
  G-->>U: PR link + execution summary
```

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Create env file

```bash
cp .env.example .env
```

3. Set minimal required env

- `TELEGRAM_BOT_TOKEN`
- `DEFAULT_REPO`
- `AGENT_CLI_TEMPLATE`
- `REPO_SNAPSHOT_ROOT`
- `DEFAULT_REPO` must match a folder name under `REPO_SNAPSHOT_ROOT`

4. Add 2 repo runtime files (copy-paste templates)

Put these files in your target repo root (example: `/Users/meow/Documents/GateForge`):

`Dockerfile.okd`

```dockerfile
# Pick ONE base image that matches your stack:
# - Node:   FROM node:22-bookworm-slim
# - Python: FROM python:3.12-slim
# - Other/custom: FROM ubuntu:24.04
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git bash build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
```

Build it once:

```bash
docker build -f Dockerfile.okd -t gateforge-okd:latest .
```

`okaydokki.yaml`

```yaml
sandbox_image: gateforge-okd:latest
test_command: python3 -m unittest discover -s tests -v
allowed_test_commands:
  - python3 -m unittest discover -s tests -v
```

5. Init DB

```bash
npm run db:init
```

6. Check runtime prerequisites

```bash
npm run preflight
```

7. Start service

```bash
npm run dev
```

## Provider Presets

Pick one provider and copy its preset into `.env`.
These presets are examples; verify flags against your installed CLI version.

### Codex (CLI session login)

```env
AGENT_PROVIDER=codex
AGENT_CLI_TEMPLATE=/Applications/Codex.app/Contents/Resources/codex exec --skip-git-repo-check --sandbox workspace-write "$OKD_INTENT"
AGENT_SESSION_CHECK_CMD=/Applications/Codex.app/Contents/Resources/codex login status
```

### Claude (example template)

```env
AGENT_PROVIDER=claude
AGENT_CLI_TEMPLATE=claude "$OKD_INTENT"
AGENT_SESSION_CHECK_CMD=claude --version
```

### Gemini (example template)

```env
AGENT_PROVIDER=gemini
AGENT_CLI_TEMPLATE=gemini "$OKD_INTENT"
AGENT_SESSION_CHECK_CMD=gemini --version
```

Notes:
- For Claude/Gemini, replace only the CLI binary/flags to match your local install.
- Keep `"$OKD_INTENT"` in the command so task intent is passed to the agent.

## Telegram Usage

### 1) Normal message (Chat)
Send a plain message (without command) to discuss ideas, tradeoffs, and next steps.

### 2) `/plan ...` (Plan first, then run)
Generate a plan, then choose:
- `Approve Plan` -> create task and run
- `Revise Plan` -> reply with feedback to get `v2`, `v3`, ...
- `Reject Plan` -> close this plan session

Example:

```text
/plan refactor task gateway and add tests
```

### 3) `/task ...` (Run directly)
Create executable task directly (still requires approval before write/run).

Example:

```text
/task add one line "Updated by OkayDokki" to README.md and keep npm test passing
```

## Commands

- `/task <goal>`: run directly (approval required)
- `/plan <goal>`: plan first, then approve to run
- `/rerun <task_id>`: rerun as a new task
- `/task status <task_id>`: show task status
- `/init repo=<repo>`: print minimal `Dockerfile.okd` + `okaydokki.yaml` setup guide

More command examples: `docs/runbook-live-test.md`

## Live Demo Script (5 min)

Run service:

```bash
npm run dev
```

Then in Telegram, run:

1. Plan request:

```text
/plan refactor task gateway routing and add tests for plan revision flow
```

2. Direct task:

```text
/task add one line "Updated by OkayDokki" to README.md and keep npm test passing
```

Expected outcome:
- Task reaches `COMPLETED` or `FAILED` with reason
- Tests result is reported
- Draft PR link appears when diff is non-empty and PR creation succeeds

## Failure Guide

| Code | Meaning | Action |
|---|---|---|
| `AGENT_FAILED` | Agent CLI execution failed | Verify `AGENT_CLI_TEMPLATE` and provider login/session |
| `SANDBOX_FAILED`, `POLICY_VIOLATION` | Runtime/policy validation failed | Verify `okaydokki.yaml` (`sandbox_image`, `test_command`, `allowed_test_commands`) and policy limits |
| `PR_CREATE_FAILED` | Draft PR creation failed | Verify git push permission and `gh auth status` |

## Operations

- Upgrade
  - `git pull && npm install && npm run db:init`
- Restart
  - Stop current process, then run `npm run dev`
- Backup DB and audit log
  - `cp okaydokki.db backup-okaydokki.db && cp audit.jsonl backup-audit.jsonl`

## Changelog

- `CHANGELOG.md`

## License

Apache License 2.0 (`Apache-2.0`). See `LICENSE`.

## Docs

- `docs/runbook-live-test.md`
- `docs/checklists/regression.md`
