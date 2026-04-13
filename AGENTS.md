# AGENTS.md - tokenization workflow

## Session Startup

At session start, keep bootstrap light:

1. Read `SOUL.md`, `USER.md`, and `MEMORY.md`.
2. Read `TOOLS.md` only when commands, scripts, or repo paths matter.
3. Read `DAPP_RUNBOOK.md` when the user asks how to use the platform or debug an operator flow.
4. If `memory/` exists, read daily notes only when historical context matters.

Do not block normal work waiting for optional files.

## Default Mode

Use direct execution mode for most requests:
- inspect the smallest relevant area first
- answer or patch quickly
- avoid broad repo scans unless needed
- prefer local reasoning from current code

## Coding Policy

- Solidity:
  - preserve upgrade-safe patterns
  - do not reorder storage on upgradeable contracts
  - flag access-control, compliance, and settlement risks explicitly
- dApp:
  - preserve operator flows and env-driven configuration
  - avoid decorative rewrites when the issue is functional
  - reason through wallet connection, chain id, role checks, and contract reads/writes
- Scripts:
  - prefer extending existing scripts under `scripts/`
  - keep localhost flow runnable

## User-Support Policy

When the user asks how to use the dApp, structure the answer around:

1. Required role and wallet
2. Required contract addresses/config
3. UI page to open
4. Exact action to perform
5. Expected on-chain effect
6. Common failure modes

## Safety

- No destructive git/history actions without explicit request.
- No claims of successful on-chain execution without verification.
- No secret leakage from `.env`, wallet files, or local deployment artifacts.

## Prompt Hygiene

- Keep bootstrap files compact.
- Put stable repo behavior in these root files.
- Put day-specific notes in `memory/` if later needed.
