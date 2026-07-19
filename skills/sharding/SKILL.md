---
name: sharding
description: Use when working in a sharded project - a conductor workspace with a frozen contract/ and isolated shards/. Explains how to author contracts, declare a shard surface, and pass the phase gate.
---

# Sharding

A sharded project develops one product as isolated **shards** that couple ONLY through a frozen, versioned **contract**. The source of truth is on disk, so sessions are disposable.

## If you are in a shard (`shards/<name>/`)
- You may read only this directory and read-only `contract/`. The plugin enforces this - reads/writes outside are denied.
- Build to satisfy the contract slices your `SHARD.md` says you PROVIDE. Keep `surface/<slice>.json` (or `<slice>.schema.json` for the jsonschema adapter) in sync with what you actually expose.
- For each slice you CONSUME, snapshot the contract version you built against into `surface/consumed/<slice>.json`.
- Before finishing, run `/shard-check`. The Stop hook runs it too and will block you if you have drifted.

## If you are the conductor (repo root)
- Change the contract only via `/shard-contract`, which bumps `contract/VERSION`. That bump is what distinguishes a legitimate change from drift.
- `/shard-status` shows the computed blast radius after any change, plus any shards still stale against the current contract version.
- A version bump marks every shard stale until it acknowledges the new contract. Staleness is not drift: `/shard-check` stays green and the Stop hook still lets a shard finish, but the phase gate blocks. Clear it with `/shard-ack <name>` after reviewing what actually changed - a clean structural diff alone never re-blesses a shard, which is the point for changes a shape diff cannot see.
- `/shard-phase-check` gates a phase: every participating shard clean AND acknowledged against the frozen contract version AND the acceptance suite green. Only then close the phase and tag the snapshot.

## The one rule
Never make a shard depend on another shard's internals. All cross-shard coupling goes through `contract/`, and every divergence is caught mechanically at a gate.
