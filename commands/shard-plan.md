---
description: Show the current phase's shards ordered into parallel waves, with any unprovided slices.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs plan` - from anywhere in the workspace.

Render the JSON as an ordered list of waves: "Wave 0: <shards>", "Wave 1: <shards>", and so on. Explain the ordering in one line - a shard waits for whatever provides the slices it consumes, and everything inside a wave is independent and can run at once.

Then handle the two advisory fields, only if they are non-empty:

- `unprovided` - each entry is a slice a shard consumes that no shard *in this phase* provides. This is not an error: the provider may be outside the phase, or may not exist yet. Say which it looks like, and note that the phase gate is what actually judges it.
- `cyclic` - shards genuinely on a dependency cycle, consuming each other's slices. Legal (they couple through the contract, not through each other), so report it as "no meaningful order, scheduled together" rather than as a failure.
- `blocked` - shards *not* on a cycle but stuck behind one. Keep these separate from `cyclic` when you report them: telling someone a shard is in a cycle it is not part of sends them looking in the wrong place.

This command only reads. To actually drive sessions, use `/shard-orchestrate`.
