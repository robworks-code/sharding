---
description: Drive a session per shard wave by wave, then run the phase gate. Conductor-only.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs orchestrate` - from the conductor root.

By default this **dispatches nothing**: it computes the plan and runs the phase gate, so the user can see what would happen. Report it that way and stop there unless the user asked to actually drive sessions.

To dispatch, add `--session-cmd '<command>'`. The command runs once per shard with its working directory set to `shards/<name>/`, which is what makes it a shard session - the sandbox is inherited from where the process starts, not re-implemented. **Confirm the exact command with the user before running it**, and show it back to them: this spawns real processes and is the one irreversible thing here. `--skip-gate` dispatches without closing the phase.

Render the result in three parts:

1. **Plan** - the waves, as in `/shard-plan`.
2. **Runs** - per shard: whether the session exited cleanly (`dispatched`, `exitCode`), and separately whether the shard is *clean* (`check.clean`). Keep these two distinct when you report them. The verdict is re-read from disk after the session ran, so a session can exit 0 and still have drifted, and a session can crash and still have left the shard clean. If `check` is `null`, that shard's surface could not be read at all - report it as unreadable and name the shard. If `error` is set, the dispatch itself failed.
3. **Gate** - the `/shard-phase-check` result: shards clean, versions acknowledged, acceptance suite. If `gate` is `null`, check `gateError`: when it is set the gate could not run at all (the contract moved under the run, say), which is a failure to report loudly, not a skip. When `gateError` is absent the gate was skipped on request. Either way, do not describe the phase as passing.

Never report the phase as passing on the strength of exit codes alone. `passed` in the JSON is the only pass signal, and it comes from the gate.
