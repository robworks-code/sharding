---
description: Author or amend the frozen contract, then bump the version (conductor-only).
---

Only run this from the conductor workspace root.

1. Edit files under `contract/interfaces/` and `contract/schemas/` (canonical structural surfaces), plus `contract/conventions.*` and `contract/phases.yaml` as needed.

   Each `.json` file in those directories MUST be a **canonical structural surface** of the exact shape below - keyed by `slice`, with a `symbols` map. A file lacking a string `slice` or a `symbols` object is rejected by the loader (it will not silently degrade). Shard surfaces are compared field-for-field against this, so model types precisely:

   ```json
   {
     "slice": "events",
     "symbols": {
       "Event": {
         "name": "Event",
         "kind": "type",
         "shape": {
           "kind": "object",
           "fields": {
             "id":         { "type": { "kind": "primitive", "name": "string" }, "required": true },
             "occurredAt": { "type": { "kind": "primitive", "name": "string" }, "required": true },
             "payload":    { "type": { "kind": "object", "fields": {} },        "required": true }
           }
         }
       }
     }
   }
   ```

   Shape kinds: `primitive` (`name`: `string`|`number`|`boolean`|`null`), `object` (`fields`), `array` (`items`), `enum` (`values`), `ref` (`name`). Symbol `kind`: `type`|`endpoint`|`event`|`function`. Do NOT invent a free-form `provides`/`operations` layout - the identity adapter diffs this canonical form directly.
2. Bump `contract/VERSION` (e.g. `v1` -> `v2`). A version bump is what makes the change legitimate rather than drift.
3. Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs status` to show the blast radius - which shards the change now puts out of conformance.
4. Report the affected shards so each can be re-aligned. Do NOT edit any shard's code from here; each shard re-aligns in its own session.
