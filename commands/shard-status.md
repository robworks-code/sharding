---
description: Show the shard graph, current phase, contract version, and computed blast radius.
---

From the repo root, run: `npx tsx ${CLAUDE_PLUGIN_ROOT}/src/cli.ts status`

Render the JSON as a table: each shard with clean/drift state, then the `blastRadius` list as "shards needing re-alignment". If the blast radius is non-empty, name the likely cause (a recent contract change or shard drift).
