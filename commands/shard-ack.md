---
description: Acknowledge this shard against the current contract version after reviewing what changed.
---

Record that this shard has been examined against the frozen contract version.

A version bump can be semantically breaking while leaving every declared shape
identical - a narrowed enum, a tightened validation rule, a redefined unit. A
clean structural diff cannot see those, so acknowledgment is deliberate: the
shard stays stale until someone confirms it actually still conforms.

**Run this from inside the shard.** A shard acknowledges itself, because it is
the only party that can read its own implementation and judge whether a
structurally invisible change still holds. The record is written into this
shard's own `surface/ACKNOWLEDGED`, so acknowledging never touches conductor
state.

Everything this command needs is inside the sandbox. `/shard-check` also works
from here if you want to confirm the shard is structurally clean first - it
finds the workspace from wherever you are, and reads without writing.

1. Confirm the current directory is inside `shards/<name>/`. If it is not, stop: the conductor does not acknowledge on a shard's behalf.
2. Read `contract/VERSION` (the version now frozen) and this shard's `surface/ACKNOWLEDGED` (the version it last reviewed; absent means it has never acknowledged one).
3. If the two already match, report "already acknowledged against <version>" and stop.
4. **Review before recording.** Compare the contract slices this shard provides and consumes as they stand now against what it was built against - `surface/consumed/<slice>.json` holds the consumed shapes as of that build. Report what changed and whether this shard's behavior still satisfies it. If anything requires a code change, make it first.
5. Only once the shard genuinely conforms, run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs ack`
6. Report the new `verifiedAgainst` version from the command's output.

Acknowledging without step 4 defeats the purpose of the gate. The record is
testimony, not proof - `/shard-phase-check` still measures this shard for real
structural drift independently, and the `Stop` hook blocks a drifted shard from
declaring itself done, so an acknowledgment can never launder a structural
problem into a green gate.
