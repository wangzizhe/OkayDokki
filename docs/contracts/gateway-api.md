# Gateway API Contract (MVP)

Base path: `/api/v1`

## 1) Create Task

`POST /tasks`

Request body:

```json
{
  "trigger_user": "tg:12345",
  "repo": "org/name",
  "intent": "fix login 500",
  "agent": "codex"
}
```

Response `201`:

```json
{
  "task": {
    "taskId": "uuid",
    "source": { "im": "api" },
    "triggerUser": "tg:12345",
    "repo": "org/name",
    "branch": "agent/1739650000000",
    "intent": "fix login 500",
    "agent": "codex",
    "status": "WAIT_APPROVE_WRITE",
    "createdAt": "2026-02-15T00:00:00.000Z",
    "approvedBy": null
  },
  "next_status": "WAIT_APPROVE_WRITE",
  "needs_clarify": false,
  "expected_path": null
}
```

Validation failures return `400`.

## 2) Get Task

`GET /tasks/:taskId`

Response `200`:

```json
{
  "task": {
    "taskId": "uuid",
    "status": "WAIT_CLARIFY"
  }
}
```

If task does not exist: `404`.

## 3) Apply Action

`POST /tasks/:taskId/actions`

Request body:

```json
{
  "action": "retry",
  "actor": "tg:12345"
}
```

Supported actions:

- `retry`
- `approve`
- `reject`

Response `200`:

```json
{
  "task": {
    "taskId": "uuid",
    "status": "WAIT_APPROVE_WRITE"
  },
  "run_result": null
}
```

For `approve`, `run_result` may include:

```json
{
  "testsResult": "PASS",
  "testLog": "ok",
  "diffHash": "sha256",
  "hasDiff": true,
  "agentLogs": ["..."],
  "agentMeta": {
    "engine": "codex",
    "protocol": "v1"
  },
  "prLink": "https://github.com/org/name/pull/123"
}
```

Errors:

- `400`: bad request body (including invalid `action`)
- `404`: task not found
- `409`: invalid state/action conflict
- `500`: run failure (including test failure)
