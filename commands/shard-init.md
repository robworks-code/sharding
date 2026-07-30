---
description: Scaffold a conductor workspace - contract/, shards/, manifest, and choose the surface adapter(s).
---

Establish a new sharded project at the repo root.

1. Ask the user which surface format this project's shards will declare (this selects the adapter). Record the default in the manifest; individual shards may override it, since a project may be multi-stack.

   | Adapter | Shard writes, for slice `X` | Pick when |
   | --- | --- | --- |
   | `identity` | `surface/X.json` | No generator - the canonical structural JSON is written directly. The safe default. |
   | `jsonschema` | `surface/X.schema.json` | The stack already emits JSON Schema. |
   | `dts` | `surface/X.d.ts` | A TypeScript shard - emit with `tsc --emitDeclarationOnly`. Needs `typescript` installed in the shard. |
   | `openapi` | `surface/X.openapi.json` (or `.yaml`) | The framework emits an OpenAPI document. |
   | `protobuf` | `surface/X.proto` | gRPC / proto-first shards. |

   Prefer an adapter whose file the shard's **build** emits over one written by hand: a generated declaration cannot disagree with the code without the build failing. Note that consumed slices use the same adapter and filename, under `surface/consumed/`. If no adapter fits the stack, say so plainly and use `identity` - do not pretend a generator exists.
2. Create:
   - `contract/interfaces/` and `contract/schemas/` (empty), `contract/VERSION` containing `v1`, `contract/conventions.md` (human notes) and optional `contract/conventions.json` (checkable rules), `contract/phases.yaml` with a first `phase-1` entry.
   - `shards/` (empty).
   - `.sharding/manifest.yaml` with `contractVersion: v1`, `currentPhase: phase-1`, empty `shards: {}`.
   - a root `CLAUDE.md` noting this is a conductor workspace.
3. Confirm the layout back to the user and point them at `/shard-contract` next.
