# Audit Log Contract (JSONL, v1.0)

Audit log is append-only JSON Lines (`.jsonl`), one JSON object per line.

## Required Fields

- `auditVersion` (string): schema version, default `1.0`
- `timestamp` (string): ISO datetime
- `taskId` (string)
- `triggerUser` (string)
- `eventType` (enum)

Allowed `eventType` values:

- `REQUEST`
- `RETRY`
- `APPROVE`
- `REJECT`
- `RUN`
- `PR_CREATED`
- `FAILED`

## Optional Fields

- `diffHash` (string)
- `agentLogs` (string[])
- `approvalDecision` (`APPROVE` | `REJECT`)
- `testsResult` (string)
- `prLink` (string)
- `message` (string)

## Validation Rules

1. `timestamp` must be a valid ISO datetime string.
2. `eventType` must be one of the allowed values.
3. `approvalDecision`, if present, must be `APPROVE` or `REJECT`.
4. `agentLogs`, if present, must be an array of strings.

## Example Records

```json
{"auditVersion":"1.0","timestamp":"2026-02-15T09:00:00.000Z","taskId":"t1","triggerUser":"tg:123","eventType":"REQUEST","message":"fix login 500"}
{"auditVersion":"1.0","timestamp":"2026-02-15T09:01:00.000Z","taskId":"t1","triggerUser":"tg:123","eventType":"APPROVE","approvalDecision":"APPROVE","message":"Approved by tg:123"}
{"auditVersion":"1.0","timestamp":"2026-02-15T09:02:00.000Z","taskId":"t1","triggerUser":"tg:123","eventType":"RUN","diffHash":"abc","testsResult":"PASS","agentLogs":["ok"]}
```

