# Live Test Runbook

This runbook is for first live integration of Telegram + agent command + draft PR flow.

## 0) Preconditions

1. Configure `.env` from `.env.example`.
2. Prepare repo snapshot under `REPO_SNAPSHOT_ROOT/<org>/<repo>`.
3. Ensure `docker` is running.
4. Ensure `gh` is installed and authenticated.

## 1) Preflight

```bash
npm run preflight
```

Expected:

- `FAIL = 0`
- `WARN` should be reviewed and resolved when possible.

## 2) Start Service

```bash
npm run db:init
npm run dev
```

Health checks:

```bash
curl -s http://localhost:3000/healthz
curl -s http://localhost:3000/api/v1/health/details | jq
```

## 3) API Smoke (before Telegram)

Use `docs/runbook-api-smoke.md` for ready-to-run `curl` commands.

Validate:

1. `POST /api/v1/tasks` creates task.
2. `GET /api/v1/tasks/:taskId` returns expected status.
3. `POST /api/v1/tasks/:taskId/actions` with `approve` advances or fails with structured `error_code`.

## 4) Telegram Live Flow

1. Send:
   - `/task repo=<org>/<repo> <your intent>`
2. If `WAIT_CLARIFY`:
   - prepare snapshot
   - tap `Retry`
3. Review approval summary
4. Tap `Approve`
5. Confirm final message includes tests + PR link (or explicit failure code)

## 5) Expected Audit Trail

Inspect `audit.jsonl`:

```bash
tail -n 50 audit.jsonl
```

Typical success events:

1. `REQUEST`
2. `APPROVE`
3. `RUN`
4. `PR_CREATED` (if diff exists and PR succeeds)

Failure event:

- `FAILED` with `errorCode` (`SNAPSHOT_MISSING`, `TEST_FAILED`, `PR_CREATE_FAILED`, etc.)

## 6) Common Failures

1. `SNAPSHOT_MISSING`
- Fix repo snapshot path under `REPO_SNAPSHOT_ROOT`.

2. `POLICY_VIOLATION`
- Diff touched blocked paths, or exceeded limits.
- Adjust intent or policy config.

3. `PR_CREATE_FAILED`
- Check `gh auth status`, repo permissions, and branch existence.

4. `SANDBOX_FAILED`
- Check Docker daemon and image pull availability.

5. `TEST_FAILED`
- Open test log in audit context and fix failing tests.

