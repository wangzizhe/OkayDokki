# Changelog

All notable changes to this project will be documented in this file.

## v0.1.1-beta - 2026-02-19

### Added

- Callback replay deduplication for Telegram actions to improve idempotency.
- `audit:task` CLI helper to print an audit timeline for a given `task_id`.
- Feedback issue template for setup friction, bugs, and feature requests.
- Regression checklist covering success path, plan-revise path, policy failures, and callback replay.
- `docs/philosophy.md` to document design principles and safety-first product boundaries.
- Provider presets in README for `codex`, `claude`, and `gemini`.
- `preflight` now validates per-repo runtime config in `okaydokki.yaml` (`sandbox_image`, `test_command`).
- `preflight` now checks whether the configured sandbox image exists locally.

### Changed

- Task completion messages now use a cleaner execution-summary format.
- Failure messages now follow the same execution-summary style with stage/reason/next-step guidance.
- Plan flow keeps human-in-the-loop approval before write/run execution.
- README improved with operations guidance (upgrade/restart/backup) and updated docs index.
- `.env.example` reorganized into required/optional/default sections with clearer comments.
- Unified provider semantics so `/task` and default chat behavior follow `AGENT_PROVIDER` by default.
- Draft PR summary terminology updated from `Intent` to `Requested`, with an added `Delivered` line.
- Added an architecture diagram to `docs/philosophy.md` to visualize approval gates, sandbox boundaries, PR delivery, and audit flow.
- Telegram messages now disable web page previews by default for cleaner task output.
- `TEST_FAILED` user-facing reason now includes a clipped test-log snippet instead of only a generic non-zero exit message.
- README Quick Start now includes minimal `Dockerfile.okd` and `okaydokki.yaml` templates.
- README was simplified to focus on core commands/demo flow and merged config+safety into `Key Concepts`.

### Fixed

- Diff parsing now supports both `git diff` and `diff -ruN` patterns for changed-file summaries.
- Removed temporary path prefixes (like `work/`) from displayed changed files.
- Improved binary-policy violation details to include offending file hints when available.
- Host diff generation now excludes `.git` and `.DS_Store` to avoid false policy violations from metadata-only changes.
- Host workspace copy/diff now excludes heavy/generated paths (`node_modules`, `dist`, `build`, `.next`, `coverage`, `.turbo`, `.cache`) to reduce long-running tasks and noisy diffs.
