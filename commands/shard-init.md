---
description: Scaffold a conductor workspace - contract/, shards/, manifest, and choose the surface adapter(s).
---

Establish a new sharded project at the repo root.

1. Ask the user which surface format this project's shards will declare (this selects the adapter): `identity` (canonical structural JSON) or `jsonschema` (JSON Schema files). Record the default in the manifest; individual shards may override.
2. Create:
   - `contract/interfaces/` and `contract/schemas/` (empty), `contract/VERSION` containing `v1`, `contract/conventions.md` (human notes) and optional `contract/conventions.json` (checkable rules), `contract/phases.yaml` with a first `phase-1` entry.
   - `shards/` (empty).
   - `.sharding/manifest.yaml` with `contractVersion: v1`, `currentPhase: phase-1`, empty `shards: {}`.
   - a root `CLAUDE.md` noting this is a conductor workspace.
3. Confirm the layout back to the user and point them at `/shard-contract` next.
