# Regression Checklist

Run this checklist before beta/release tags.

## 1) Success Path (`/task`)

- [ ] Start service: `npm run dev`
- [ ] Send `/task repo=<repo> <small textual change> and keep npm test passing`
- [ ] Approve write (`Approve` button)
- [ ] Verify final message shows:
  - [ ] `Task ... completed`
  - [ ] `Execution summary` with files/tests/PR
- [ ] Verify Draft PR link is present when diff is non-empty

## 2) Plan Revise Path (`/plan`)

- [ ] Send `/plan repo=<repo> <goal>`
- [ ] Verify `Plan v1` appears with buttons
- [ ] Click `Revise Plan`, send feedback
- [ ] Verify `Plan v2` appears
- [ ] Click old v1 `Approve Plan` and verify `Plan is outdated` message
- [ ] Click v2 `Approve Plan`
- [ ] Verify task enters `WAIT_APPROVE_WRITE`
- [ ] Click `Approve` and verify completion flow

## 3) Policy Failure Path (`POLICY_VIOLATION`)

- [ ] Send a task that introduces binary or blocked-path change
- [ ] Approve write
- [ ] Verify failure message shows:
  - [ ] `Task ... failed`
  - [ ] `Execution summary`
  - [ ] `Code: POLICY_VIOLATION`
  - [ ] clear `Reason` and `Suggested next step`

## 4) Callback Replay / Idempotency

- [ ] Click `Approve` once, then click the same button again quickly
- [ ] Verify duplicate action is rejected with `Action already processed.`
- [ ] Verify audit timeline has no duplicate `APPROVE`/`RUN` for same task

## 5) Audit Query Check

- [ ] Run: `npm run audit:task -- <task_id>`
- [ ] Verify timeline is readable and includes core events (`REQUEST`, `APPROVE`, `RUN`, `FAILED|PR_CREATED`)
