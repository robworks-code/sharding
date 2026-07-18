---
description: Register a new shard - directory, charter, sandbox guardrails, and manifest entry.
argument-hint: "<name>"
---

Create and register shard `$1`.

1. Create `shards/$1/` with:
   - `SHARD.md` - charter: purpose, the contract slices it PROVIDES and CONSUMES, explicit boundaries.
   - `CLAUDE.md` - reminder that this session may read only this directory and read-only `contract/`, and couples to others solely through the contract.
   - `surface/` (empty) for its declared provided surface, and `surface/consumed/` for snapshots of consumed slices.
2. Add an entry under `shards:` in `.sharding/manifest.yaml`: `dir: shards/$1`, `adapter: <project default or chosen>`, `provides: [...]`, `consumes: [...]`.
3. Remind the user to open a fresh session inside `shards/$1/` to build it.
