# Provider Auth Modes

OkayDokki supports two provider auth modes:

- `session` (default, recommended for self-hosted personal deployment)
- `api` (optional, for key-based integration)

## Session Mode (Bring Your Own Subscription Login)

Use your local CLI login/session from the provider tooling.

Typical flow:

1. Install your agent CLI on host machine.
2. Login once using the provider CLI flow.
3. Configure `AGENT_CLI_TEMPLATE` in `.env`.
4. Set `AGENT_AUTH_MODE=session`.
5. Optional: set `AGENT_SESSION_CHECK_CMD` so preflight can verify login state.

Notes:

- OkayDokki does not need to store provider API keys in this mode.
- This is the fastest path for users who already have a subscription account.

## API Mode (Bring Your Own API Key)

Use provider API keys in environment variables.

Notes:

- Better for centralized/team deployment.
- Easier to standardize service-side credential management.
- In this repository, `api` mode is config-level ready, while concrete key wiring depends on your selected agent adapter implementation.

## Recommended for MVP

- Default: `AGENT_AUTH_MODE=session`
- Keep `TELEGRAM_MODE=polling` for easiest personal self-hosted setup
