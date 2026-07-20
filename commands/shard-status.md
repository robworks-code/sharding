---
description: Show the shard graph, current phase, contract version, and computed blast radius.
---

From the repo root, run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs status`

Render the JSON as a table: each shard with clean/drift state, then the `blastRadius` list as "shards needing re-alignment", then the `staleShards` list as "shards that have not acknowledged contract `<contractVersion>`". If the blast radius is non-empty, name the likely cause (a recent contract change or shard drift). Stale shards are not drifted - they block only the phase gate, and each clears itself with `/shard-ack` from inside that shard.
