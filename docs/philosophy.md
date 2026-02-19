# OkayDokki Design Philosophy

> OkayDokki is an AI employee that is useful by default, and restrained by default.

It can execute work, but it cannot decide on your behalf.
It can move tasks forward, but it cannot cross authority boundaries.

## 1. AI Is an Executor, Not a Decision Maker

Core rule:

> Responsibility always stays on the human side.

Therefore:

- AI can analyze, suggest, and generate patches.
- AI cannot decide whether code should be written.
- AI cannot decide whether changes should be merged.
- AI cannot decide process-critical next steps without explicit approval.

Any action that changes Git history requires human confirmation.

## 2. Zero Trust by Default

OkayDokki does not assume AI behavior is always safe, reliable, or predictable.

Default posture:

- Read-only repository mount for execution context.
- No network access in sandbox validation.
- No unrestricted shell execution path.
- No direct write to protected branches.

Any boundary expansion must be:

- Explicit
- Auditable
- Rejectable

> Trust is granted progressively, never assumed.

## 3. Remove Capability Before Adding Capability

The design question is not:

> What else can we support?

It is:

> Should this capability exist at all?

OkayDokki intentionally does **not** target:

- Unrestricted remote shell access
- Unattended autonomous code writes
- Auto-deploy to production
- Generic workflow orchestration platform behavior

This is not a temporary gap; it is a product boundary.

## 4. PR Is the Only Code Delivery Artifact

In OkayDokki:

- The only code delivery artifact is a Pull Request.
- Changes must be reviewable, replayable, and auditable.
- Responsibility boundaries are anchored in Git and PR workflows.

No hidden edits, no black-box code delivery, no untraceable state transitions.

> Git is the source of truth; PR is the minimum safety unit.

## 5. Chat Is a Workflow Entry, Not a Console

IM channels (Telegram, WeCom, etc.) are used for:

- Async task submission
- Requirement clarification
- Approval decisions

Design constraints:

- Chat surfaces summaries, options, and confirmations.
- Deep details belong in PRs and logs.
- Chat is not a substitute for unrestricted terminal control.

> IM is a remote control, not an operations console.

## 6. Safety Must Be Structural, Not Instructional

OkayDokki does not rely on:

- Prompt-only guardrails
- User discipline
- "Use carefully" documentation

Safety must come from architecture:

- Dangerous paths do not exist in normal operation.
- Misconfiguration has bounded blast radius.
- The system is designed to fail safely.

> If one wrong setting can cause a disaster, the design is incomplete.

## 7. Personal-first, Not Enterprise-first

OkayDokki assumes many users are solo developers or small-team owners:

- No dedicated IT team
- No internal platform team
- No heavyweight approval chain

So defaults prioritize:

- Self-hosted simplicity
- Fast setup with minimal tuning
- Clear operational behavior

## 8. Tool, Not Platform

OkayDokki is intentionally not:

- A generic agent framework
- A plugin marketplace
- A universal integration hub

It is built to solve one problem:

> Let AI produce code changes safely, so humans can confidently review and ship.

## 9. Tradeoff Priority Order

When goals conflict, priority is always:

1. Safety
2. Control
3. Auditability
4. Simplicity
5. Efficiency
6. Feature breadth

If a feature improves speed but weakens safety or control, it should not ship.

## Governance Rule

Philosophy is part of the product contract.

Any exception or principle change should be made through an explicit proposal (mini RFC), with:

- The reason for change
- The safety impact
- The rollback plan

## Final Summary

> OkayDokki is not designed to make AI freer.
> It is designed to make humans safer.
