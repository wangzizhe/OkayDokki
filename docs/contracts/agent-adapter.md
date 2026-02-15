# Agent Adapter Contract (CLI v1)

This contract defines how OkayDokki executes an agent command in sandbox mode.

## Execution Model

- Adapter provides one shell command string via `AGENT_CLI_TEMPLATE`.
- Command runs inside Docker with current directory `/work`.
- Source snapshot is mounted read-only at `/repo`.
- Mutable workspace is `/work`.
- Output directory is `/out`.
- Network is disabled (`--network none`).

## Input to Agent Command

Agent command receives these environment variables:

- `OKD_TASK_ID`
- `OKD_REPO`
- `OKD_BRANCH`
- `OKD_TRIGGER_USER`
- `OKD_INTENT`
- `OKD_WORKDIR` (always `/work`)
- `OKD_OUTDIR` (always `/out`)

## Expected Agent Behavior

1. Apply edits under `/work` only.
2. Exit `0` on success, non-zero on failure.
3. Write logs to stdout/stderr (captured as `/out/agent.log`).
4. Optional: write metadata JSON to `/out/agent.meta.json`.

## Standard Outputs Produced by Runner

- `/out/agent.log`
- `/out/agent.exit`
- `/out/patch.diff`
- `/out/test.log`
- `/out/test.exit`

## Optional Agent Metadata

If `/out/agent.meta.json` exists, it should be a flat JSON object with string values.

Example:

```json
{
  "engine": "codex",
  "protocol": "v1"
}
```

The runner parses this file and returns it as `run_result.agentMeta`.

