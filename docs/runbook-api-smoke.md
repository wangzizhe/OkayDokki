# API Smoke Commands

Set base URL:

```bash
export OKD_BASE_URL="http://localhost:3000"
```

## 1) Health

```bash
curl -s "$OKD_BASE_URL/healthz"
curl -s "$OKD_BASE_URL/api/v1/health/details" | jq
```

## 2) Create Task

```bash
CREATE_RES=$(curl -s -X POST "$OKD_BASE_URL/api/v1/tasks" \
  -H "content-type: application/json" \
  -d '{
    "trigger_user":"api:smoke",
    "repo":"org/name",
    "intent":"smoke: update a tiny text",
    "agent":"codex"
  }')

echo "$CREATE_RES" | jq
export TASK_ID=$(echo "$CREATE_RES" | jq -r '.task.taskId')
echo "TASK_ID=$TASK_ID"
```

## 3) Get Task

```bash
curl -s "$OKD_BASE_URL/api/v1/tasks/$TASK_ID" | jq
```

## 4) List Tasks

```bash
curl -s "$OKD_BASE_URL/api/v1/tasks?limit=10" | jq
```

## 5) Approve Task

```bash
curl -s -X POST "$OKD_BASE_URL/api/v1/tasks/$TASK_ID/actions" \
  -H "content-type: application/json" \
  -d '{
    "action":"approve",
    "actor":"api:smoke"
  }' | jq
```

If it fails, inspect:

- `error`
- `error_code`

## 6) Rerun Task

```bash
RERUN_RES=$(curl -s -X POST "$OKD_BASE_URL/api/v1/tasks/$TASK_ID/rerun" \
  -H "content-type: application/json" \
  -d '{
    "actor":"api:smoke"
  }')

echo "$RERUN_RES" | jq
export RERUN_TASK_ID=$(echo "$RERUN_RES" | jq -r '.task.taskId')
echo "RERUN_TASK_ID=$RERUN_TASK_ID"
```

## 7) Reject Rerun (optional)

```bash
curl -s -X POST "$OKD_BASE_URL/api/v1/tasks/$RERUN_TASK_ID/actions" \
  -H "content-type: application/json" \
  -d '{
    "action":"reject",
    "actor":"api:smoke"
  }' | jq
```

