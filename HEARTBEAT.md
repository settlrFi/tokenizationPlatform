# HEARTBEAT.md

Use proactive checks sparingly. This workspace is primarily coding and operator support, not background automation.

When a periodic check is explicitly requested, prefer:
- local build health
- stale address/config mismatches
- missing role/compliance prerequisites called out in docs
- frontend/backend script drift

Do not autonomously perform deployments, upgrades, or irreversible on-chain actions.
