# Task Lifecycle Contract (MVP)

## Statuses

- `CREATED`
- `WAIT_CLARIFY`
- `WAIT_APPROVE_WRITE`
- `RUNNING`
- `PR_CREATED`
- `COMPLETED`
- `FAILED`

## Allowed Transitions

- `CREATED -> WAIT_CLARIFY`
- `CREATED -> WAIT_APPROVE_WRITE`
- `CREATED -> FAILED`
- `WAIT_CLARIFY -> WAIT_APPROVE_WRITE`
- `WAIT_CLARIFY -> FAILED`
- `WAIT_APPROVE_WRITE -> RUNNING`
- `WAIT_APPROVE_WRITE -> FAILED`
- `RUNNING -> PR_CREATED`
- `RUNNING -> COMPLETED`
- `RUNNING -> FAILED`
- `PR_CREATED -> COMPLETED`
- `PR_CREATED -> FAILED`

## Events and Expected Behavior

1. `REQUEST`
- Triggered when a new task is created.
- If repo snapshot exists, task enters `WAIT_APPROVE_WRITE`.
- If snapshot is missing, task enters `WAIT_CLARIFY`.

2. `RETRY`
- Allowed only when task is `WAIT_CLARIFY`.
- Requires repo snapshot to exist.
- Moves task to `WAIT_APPROVE_WRITE`.

3. `APPROVE`
- Allowed only when task is `WAIT_APPROVE_WRITE`.
- Moves task to `RUNNING`, then executes agent and tests in sandbox.
- On success:
  - `RUN` event is logged.
  - If diff is non-empty and PR link exists: `PR_CREATED` event is logged.
  - Task ends at `COMPLETED`.
- On failure:
  - `FAILED` event is logged (includes agent/test failures).
  - Task moves to `FAILED`.

4. `REJECT`
- Allowed from pending states.
- Moves task to `FAILED`.

## Guardrails

- Approval is required before any run/apply behavior.
- Missing repo snapshot blocks approval and keeps task in clarify flow.
- All state changes must be auditable via JSONL events.
