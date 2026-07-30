---
description: Drive a session per shard wave by wave, then run the phase gate. Conductor-only.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs orchestrate` - from the conductor root.

By default this **dispatches nothing**: it computes the plan and runs the phase gate, so the user can see what would happen. Report it that way and stop there unless the user asked to actually drive sessions.

To dispatch, use one of:

- `--session-preset claude` - drive a real headless Claude Code session per shard. This is the blessed form. The prompt is generated from each shard's `SHARD.md`, its manifest entry and its adapter's surface paths; the session runs with `--print` and is granted `--add-dir <root>/contract` so it can read the contract it is measured against. Tune it with `--session-task '<what this phase is for>'`, `--session-model`, and `--session-permission-mode` (default `acceptEdits`; `bypassPermissions` is the genuinely unattended setting and should be named explicitly to the user before you use it).
- `--session-cmd '<command>'` - drive an arbitrary command instead. The two are alternatives; passing both is an error.

Either way the process runs once per shard with its working directory set to `shards/<name>/`, which is what makes it a shard session - the sandbox is inherited from where the process starts, not re-implemented.

**Before dispatching, run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs session-preview` (optionally with a shard name) and show the user the exact `args` it prints.** It spawns nothing. This is the one irreversible thing the engine does, so the user approves the real invocation, not a description of it. Pass the same `--session-*` flags to the preview that you intend to pass to `orchestrate`, or you will be showing them something you are not about to run.

The preview reports `args` once (they are the same for every shard), `promptDelivery: "stdin"`, and a per-shard `prompt`. The prompt is fed on stdin rather than as an argument, so do not describe it as part of the command line.

`--skip-gate` dispatches without closing the phase. `--halt-on-wave-failure` stops after any wave that left a shard unclean, which is worth suggesting when sessions are expensive - a consumer dispatched against a provider that just failed is building against a slice that is not there yet. It keys off `check.clean`, not exit codes, so a session that crashed having left its shard conforming does not stop the run.

Render the result in four parts:

1. **Plan** - the waves, as in `/shard-plan`.
2. **Runs** - per shard: whether the session exited cleanly (`dispatched`, `exitCode`), and separately whether the shard is *clean* (`check.clean`). Keep these two distinct when you report them. The verdict is re-read from disk after the session ran, so a session can exit 0 and still have drifted, and a session can crash and still have left the shard clean. If `check` is `null`, that shard's surface could not be read at all - report it as unreadable and name the shard. If `error` is set, the dispatch itself failed.
3. **Halt** - if the `haltedAfterWave` key is **present**, dispatch stopped early. Test for presence, not truthiness: a first-wave halt is `0`, which is the most common case and is falsy. The shards in `skipped` never ran and have no entry in `runs` at all - name them as not attempted, and do not describe them as clean or passing.
4. **Gate** - the `/shard-phase-check` result: shards clean, versions acknowledged, acceptance suite. If `gate` is `null`, check `gateError`: when it is set the gate could not run at all (the contract moved under the run, say), which is a failure to report loudly, not a skip. When `gateError` is absent the gate was skipped on request. Either way, do not describe the phase as passing.

Never report the phase as passing on the strength of exit codes alone. `passed` in the JSON is the only pass signal, and it comes from the gate.
