---
description: Author or amend the frozen contract, then bump the version (conductor-only).
---

Only run this from the conductor workspace root.

1. Edit files under `contract/interfaces/` and `contract/schemas/` (canonical structural surfaces), plus `contract/conventions.*` and `contract/phases.yaml` as needed.
2. Bump `contract/VERSION` (e.g. `v1` -> `v2`). A version bump is what makes the change legitimate rather than drift.
3. Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs status` to show the blast radius - which shards the change now puts out of conformance.
4. Report the affected shards so each can be re-aligned. Do NOT edit any shard's code from here; each shard re-aligns in its own session.
