---
description: Gate the current phase - all participating shards must be clean and the acceptance suite must pass.
---

This is the phase gate. From the repo root, run: `npx tsx ${CLAUDE_PLUGIN_ROOT}/src/cli.ts phase-check`

Report `shardsClean`, `acceptancePassed`, and overall `passed`. If `passed` is false, list the findings and the tail of `acceptanceOutput`. Only when `passed` is true may the phase be declared closed; then tag the integrable snapshot and advance `currentPhase`.
