# Live Test Runbook (Single Reference)

This is the single runbook for first live integration of Telegram + agent + draft PR flow.

## 0) Preconditions

1. Configure `.env` from `.env.example`.
2. For self-hosted personal setup, prefer:
   - `TELEGRAM_MODE=polling`
   - `AGENT_AUTH_MODE=session`
3. If `AGENT_AUTH_MODE=session`, login your agent CLI first (example: `codex login`).
4. Prepare repo snapshot under `REPO_SNAPSHOT_ROOT/<repo>` (or your chosen repo id path).
5. In the target repo root, add runtime config:
   - `Dockerfile.okd`
   - `okaydokki.yaml` with `sandbox_image`, `test_command`, `allowed_test_commands`
6. Ensure `docker` is running.
7. Ensure `gh` is installed and authenticated.

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

Set base URL:

```bash
export OKD_BASE_URL="http://localhost:3000"
```

Health:

```bash
curl -s "$OKD_BASE_URL/healthz"
curl -s "$OKD_BASE_URL/api/v1/health/details" | jq
```

Create one task:

```bash
CREATE_RES=$(curl -s -X POST "$OKD_BASE_URL/api/v1/tasks" \
  -H "content-type: application/json" \
  -d '{
    "trigger_user":"api:smoke",
    "repo":"okd-sandbox",
    "intent":"smoke: append one line to README",
    "agent":"codex"
  }')

echo "$CREATE_RES" | jq
TASK_ID=$(echo "$CREATE_RES" | jq -r '.task.taskId')
echo "$TASK_ID"
```

Check status:

```bash
curl -s "$OKD_BASE_URL/api/v1/tasks/$TASK_ID" | jq
curl -s "$OKD_BASE_URL/api/v1/tasks?limit=10" | jq
```

Approve:

```bash
curl -s -X POST "$OKD_BASE_URL/api/v1/tasks/$TASK_ID/actions" \
  -H "content-type: application/json" \
  -d '{"action":"approve","actor":"api:smoke"}' | jq
```

## 4) Telegram Live Flow

1. Send:
   - `/task <your intent>`
2. If `WAIT_CLARIFY`:
   - If runtime config is missing, run:
     - `/init repo=<repo>`
     - create `Dockerfile.okd` and `okaydokki.yaml` in repo root
   - If snapshot is missing, prepare snapshot under `REPO_SNAPSHOT_ROOT`
   - tap `Retry`
3. Review approval summary
4. Tap `Approve`
5. Observe progress updates:
   - `agent running...`
   - `sandbox testing...`
   - `creating Draft PR...` (when applicable)
6. Confirm final message includes tests + PR link (or explicit failure code)

## 5) Expected Audit Trail

Inspect `audit.jsonl`:

```bash
tail -n 50 audit.jsonl
```

Or query one task directly:

```bash
npm run audit:task -- <task_id>
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
- Check Docker daemon/image and `okaydokki.yaml` command allowlist.

5. `TEST_FAILED`
- Use `npm run audit:task -- <task_id>` and fix failing tests.

## 7) Quick Checklist

- [ ] `.env` configured from `.env.example`
- [ ] `npm run preflight` has `FAIL = 0`
- [ ] `npm run db:init` succeeds
- [ ] `npm run dev` is running
- [ ] `/task ...` creates task message
- [ ] progress updates appear during execution (`agent` -> `sandbox` -> `draft PR`)
- [ ] approve/reject buttons work
- [ ] audit log records `REQUEST/APPROVE/RUN` (+ `PR_CREATED` when applicable)
