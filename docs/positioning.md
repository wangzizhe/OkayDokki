# OkayDokki Positioning

This page compares OkayDokki with common AI coding product paradigms.
The focus is responsibility model and default behavior, not raw feature count.

## High-level Comparison

| Dimension | OkayDokki | GitHub / Copilot | SWE Agents | IDE Agents |
|---|---|---|---|---|
| Primary role | Decision-first orchestration | Execution acceleration | Autonomous completion | Interactive assistance |
| Core problem | Idea-to-execution gap | Workflow speed | Automation | Coding productivity |

## Entry and Control

| Dimension | OkayDokki | Common Alternatives |
|---|---|---|
| IM/mobile support | Yes | Often yes |
| Mobile as first-class decision surface | Yes | Usually no |
| Mobile-only approval path | Yes | Rare |
| IM semantic | Decision and approval | Trigger and notification |

In OkayDokki, IM is a decision surface, not only an input channel.

## Plan vs Execution Defaults

| Dimension | OkayDokki | Common Alternatives |
|---|---|---|
| Default mode | Plan-first | Execute-first |
| Planning step | Explicit | Optional or implicit |
| Execution without explicit approval | No | Often possible |
| Human role | Decision-maker before execution | Reviewer after execution |

## Draft PR Semantics

| Dimension | OkayDokki | Common Alternatives |
|---|---|---|
| Draft PR purpose | Contract and review boundary | Usually post-execution output |
| Responsibility semantics | Approved intent first | Result first |
| Merge readiness | Requires explicit human decision | Varies by product flow |

In OkayDokki, a Draft PR represents what was approved to run and what must be reviewed.

## Execution Model

| Dimension | OkayDokki | Common Alternatives |
|---|---|---|
| Runtime location | User-controlled environment | Often platform-managed runtime |
| Infrastructure dependency | Self-hosted friendly | Often always-on platform |
| Agent ownership model | Your configured agent | Vendor-managed agent |

## Responsibility and Risk

| Dimension | OkayDokki | Common Alternatives |
|---|---|---|
| Execution authorization | Explicit human approval | Often implicit policy/automation |
| Offline autonomous run | Not a default pattern | Frequently supported |
| Responsibility clarity | High | Medium |

## Target Users and Usage Pattern

| Dimension | OkayDokki | Common Alternatives |
|---|---|---|
| Primary users | Individual developers and side projects | Teams and enterprise-heavy workflows |
| Usage rhythm | Async and intermittent | Continuous |
| Core mindset | Do not lose this idea | Finish this task faster |

## Explicit Non-Goals

OkayDokki is intentionally not:

- A fully autonomous SWE agent
- An always-on background executor
- An IDE replacement
- A hosted platform that runs your repository code for you

## One-line Summary

OkayDokki optimizes for correct decisions over fast execution.
Execution is a privilege, not a default.
