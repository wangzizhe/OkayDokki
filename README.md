# OkayDokki

<p align="center">
  <a href="https://github.com/wangzizhe/OkayDokki/actions/workflows/ci.yml" style="text-decoration:none;"><img src="https://github.com/wangzizhe/OkayDokki/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>&nbsp;
  <a href="LICENSE" style="text-decoration:none;"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License" /></a>&nbsp;
  <a href="https://nodejs.org/" style="text-decoration:none;"><img src="https://img.shields.io/badge/node-%3E%3D22-339933.svg" alt="Node >= 22" /></a>
</p>
Text your AI agent. Work from anywhere, anytime. 

Approve safely, run in sandbox, ship via Draft PRs.

OkayDokki is a human-in-the-loop AI code delivery agent for Telegram:
- chat and plan like you talk to a developer,
- require explicit approval before write/run,
- deliver only through Draft PRs with audit logs.

---

Message your AI agent from anywhere, anytime.

![OkayDokki ChatBot](docs/assets/chat_full.png)

It works in a sandbox and opens a Draft PR. You approve before merge.

![OkayDokki DraftPR](docs/assets/draftPR.png)

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

4. Init DB

```bash
npm run db:init
```

5. Check runtime prerequisites

```bash
npm run preflight
```

6. Start service

```bash
npm run dev
```

## Minimal Config

- `TELEGRAM_MODE` (`polling` recommended for self-hosted)
- `TELEGRAM_BOT_TOKEN`
- `DEFAULT_REPO`
- `AGENT_AUTH_MODE` (`session` recommended)
- `AGENT_PROVIDER` (`codex` | `claude` | `gemini`)
- `AGENT_CLI_TEMPLATE`
- `DELIVERY_STRATEGY` (`rolling` or `isolated`)
- `BASE_BRANCH` (usually `main`)

## Provider Presets

Pick one provider and copy its preset into `.env`.
These presets are examples, verify flags against your installed CLI version.

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
- Claude/Gemini command flags vary by CLI release. Adjust the command to your installed version.
- Keep `"$OKD_INTENT"` in the command so task intent is passed to the agent.

## Safety Defaults

- Approval required before write/run
- Draft PR only
- Diff policy guard (blocked paths, size/file limits, binary controls)
- Full audit log in `audit.jsonl`

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
/plan repo=okd-sandbox refactor task gateway and add tests
```

### 3) `/task ...` (Run directly)
Create executable task directly (still requires approval before write/run).

Example:

```text
/task repo=okd-sandbox add one line "Updated by OkayDokki" to README.md and keep npm test passing
```

## Commands

### Core Commands

- `/task status <task_id>`: show task status
- `/rerun <task_id>`: rerun as a new task
- `/help`: show compact command guide
- `/last`: show latest task summary

### Advanced Commands

- `/strategy`: show your strategy preference
- `/strategy rolling|isolated`: set preference
- `/strategy clear`: reset preference to default
- `/chat repo=<repo> ...`: optional explicit chat command
- `/chat reset`: clear chat short-memory
- `/chat cancel`: cancel active chat request

## Live Demo Script (5 min)

Run service:

```bash
npm run dev
```

Then in Telegram, send these in order:

1. Chat (normal message)

```text
What are 2 risks of rolling PR strategy in this repo?
```

2. Plan request

```text
/plan repo=okd-sandbox refactor task gateway routing and add tests for plan revision flow
```

3. Click `Revise Plan`, send one feedback message, then click `Approve Plan`

```text
Keep the plan very short, in English, and include one rollback check.
```

4. Click `Approve` on task approval summary (optional: `/rerun <task_id>`)

```text
/rerun <task_id>
```

Expected outcome:
- Task reaches `COMPLETED` or `FAILED` with reason
- Tests result is reported
- Draft PR link appears when diff is non-empty and PR creation succeeds

## Failure Guide

| Code | Meaning | Action |
|---|---|---|
| `POLICY_VIOLATION` | Diff violates policy (blocked path, size/files limit, or binary patch) | Reduce task scope or adjust `.env` policy limits |
| `AGENT_FAILED` | Agent CLI execution failed | Verify `AGENT_CLI_TEMPLATE` and provider login/session |
| `SANDBOX_FAILED` | Sandbox validation/test failed | Verify Docker/image and allowed test command |
| `PR_CREATE_FAILED` | Draft PR creation failed | Verify git push permission and `gh auth status` |

## Operations

- Upgrade
  - `git pull && npm install && npm run db:init`
- Restart
  - Stop current process, then run `npm run dev`
- Backup DB and audit log
  - `cp okaydokki.db backup-okaydokki.db && cp audit.jsonl backup-audit.jsonl`

## Design Philosophy

- `docs/philosophy.md`

## Changelog

- `CHANGELOG.md`

## License

Apache License 2.0 (`Apache-2.0`). See `LICENSE`.

## Docs

- `docs/runbook-live-test.md`
- `docs/checklists/regression.md`
