# Live Integration Checklist

Use this checklist before and during real Telegram + agent + draft PR integration.

## A) Environment

- [ ] `.env` exists (copied from `.env.example`)
- [ ] `TELEGRAM_BOT_TOKEN` is set (not placeholder)
- [ ] `TELEGRAM_WEBHOOK_SECRET` is set (not placeholder)
- [ ] `BASE_URL` is set to public reachable HTTPS URL
- [ ] `DEFAULT_REPO` is set to real `<org>/<repo>`
- [ ] `AGENT_CLI_TEMPLATE` is set (placeholder or real command)

## B) Local Dependencies

- [ ] `docker --version` works
- [ ] `gh --version` works
- [ ] `gh auth status -h github.com` passes
- [ ] repo snapshot exists at `REPO_SNAPSHOT_ROOT/<org>/<repo>`

## C) Preflight + Service Boot

- [ ] `npm run preflight` has `FAIL = 0`
- [ ] `npm run db:init` succeeds
- [ ] `npm run dev` starts server
- [ ] `GET /healthz` returns `{ "ok": true }`
- [ ] `GET /api/v1/health/details` returns status `ok`

## D) API Smoke

- [ ] `POST /api/v1/tasks` returns `201`
- [ ] `GET /api/v1/tasks/:taskId` returns expected status
- [ ] `POST /api/v1/tasks/:taskId/actions` with `approve` returns run result or structured failure
- [ ] `POST /api/v1/tasks/:taskId/rerun` returns `201`

## E) Telegram Flow

- [ ] `/task repo=<org>/<repo> ...` creates task message
- [ ] If clarify required, `Retry` works after snapshot is ready
- [ ] Approval summary is shown before approve buttons
- [ ] `Approve` runs task and returns completion/failure message with code
- [ ] `Reject` moves task to failed path

## F) Audit + PR

- [ ] `audit.jsonl` has `REQUEST`, `APPROVE`, `RUN` (and `PR_CREATED` when applicable)
- [ ] failure records include `errorCode`
- [ ] draft PR link is created when diff exists and policy passes
- [ ] no PR is created when diff is empty

