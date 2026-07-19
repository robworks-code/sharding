---
description: Acknowledge a shard against the current contract version after reviewing what changed.
argument-hint: "[shard-name]"
---

Record that a shard has been examined against the frozen contract version.

A version bump can be semantically breaking while leaving every declared shape
identical - a narrowed enum, a tightened validation rule, a redefined unit. A
clean structural diff cannot see those, so acknowledgment is deliberate: the
shard stays stale until someone confirms it actually still conforms.

1. Determine the shard: if `$1` is given, use it; otherwise infer from the current directory (`shards/<name>/`).
2. From the repo root, run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs check <shard>`
3. If it reports drift (exit non-zero), stop: the drift must be resolved first. `ack` will refuse anyway. Check this before staleness - the two are independent, and a shard can be drifted while already acknowledged.
4. If the check reports `versionStale: false`, report "already acknowledged against <version>" and stop.
5. **Review before stamping.** Diff the contract slices this shard provides and consumes against the version it was last verified against (`verifiedAgainst` in the check output). Report what changed, and whether the shard's behavior still satisfies it. If anything requires a code change, make it and re-check before acknowledging.
6. Only once the shard genuinely conforms, run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs ack <shard>`
7. Report the new `verifiedAgainst` version.

Acknowledging without step 5 defeats the purpose of the gate.
