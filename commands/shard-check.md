---
description: Check a shard's declared surface against the frozen contract (provide + consume + conventions).
argument-hint: "[shard-name]"
---

Run the deterministic shard check and report findings.

1. Determine the shard: if `$1` is given, use it; otherwise infer from the current directory (`shards/<name>/`).
2. From the repo root, run: `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs check <shard>`
3. If exit code is 0, report "clean - conforms to contract <version>".
4. If non-zero, present each finding as `slice | kind | location | expected -> actual` and stop; do not claim the shard is done.
