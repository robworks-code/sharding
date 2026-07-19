---
description: Gate the current phase - all participating shards must be clean, acknowledged, and the acceptance suite must pass.
---

This is the phase gate. From the repo root, run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs phase-check`

Report `shardsClean`, `versionsAcknowledged`, `acceptancePassed`, and overall `passed`. If `passed` is false:

- List the findings and the tail of `acceptanceOutput`.
- If `versionsAcknowledged` is false, name every shard in `staleShards`. Each was never checked against the frozen contract version; resolve with `/shard-ack <name>` after reviewing what the bump changed.

Only when `passed` is true may the phase be declared closed; then tag the integrable snapshot and advance `currentPhase`.
