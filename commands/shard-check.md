---
description: Check a shard's declared surface against the frozen contract (provide + consume + conventions).
argument-hint: "[shard-name]"
---

Run the deterministic shard check and report findings.

1. Run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs check $1`

   This works from anywhere in the workspace - the conductor root, a shard, or any
   directory under either. With no shard name it checks the shard you are inside;
   from outside a shard, name one. The check is read-only, so a shard session can
   run it on itself without leaving its sandbox.
2. If exit code is 0, report "clean - conforms to contract <version>".
3. If non-zero, present each finding as `slice | kind | location | expected -> actual` and stop; do not claim the shard is done.
4. If the output is `checked: false`, you are outside a shard and named none - ask which shard, or run it from inside one.
