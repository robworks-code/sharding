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

1. Confirm the current directory is inside `shards/<name>/`. If it is not, stop: the conductor does not acknowledge on a shard's behalf.
2. Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs check <name>` and read `verifiedAgainst` and `versionStale`.
3. If it reports drift (exit non-zero), stop: resolve the drift first. Check this before staleness - the two are independent, and a shard can be drifted while already acknowledged.
4. If `versionStale` is false, report "already acknowledged against <version>" and stop.
5. **Review before recording.** Diff the contract slices this shard provides and consumes against the version in `verifiedAgainst`. Report what changed, and whether this shard's behavior still satisfies it. If anything requires a code change, make it and re-check before acknowledging.
6. Only once the shard genuinely conforms, run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs ack`
7. Report the new `verifiedAgainst` version.

Acknowledging without step 5 defeats the purpose of the gate. The record is
testimony, not proof - `/shard-phase-check` still measures this shard for real
drift independently, so an acknowledgment can never launder a structural
problem into a green gate.
