# Sharding

Build a large software product as a set of deliberately separated components ("shards"), each developed in its own isolated [Claude Code](https://claude.com/claude-code) session, coupled only through a frozen, versioned **contract**, and integrated in phases where each phase produces a provably integrable deliverable.

This repository is the proof-of-concept: a Claude Code plugin plus the deterministic engine underneath it.

**[robworks-code.github.io/sharding](https://robworks-code.github.io/sharding/)** walks through the whole idea top to bottom: the failure mode it addresses, the mechanism, and the two-shard demo with real output.

## The idea

The premise is that **LLM inconsistency is a given, not something to hope away**. The system never asks a session to "remember" the whole product. Instead it makes the shared truth external, small, and mechanically enforced:

- A shard can only ever see its own slice plus a read-only copy of the contract.
- Any divergence from the contract is caught by deterministic tooling at a gate - the same way a type error blocks a build, not by an agent noticing.

> The thesis under test: N independently-driven, isolated shards, coupled only through a frozen contract and gated mechanically, will snap together into an integrable deliverable at each phase - despite each session being individually forgetful.

## How it works

Everything lives on disk, so sessions are disposable and re-orient themselves from files rather than memory.

```
project-root/                  # conductor workspace - open Claude Code here to orchestrate
  contract/                    # THE frozen truth; read-only to shards (hook-enforced)
    interfaces/                # APIs, signatures, endpoints, event names
    schemas/                   # shared data shapes (JSON Schema / shared types)
    conventions.json           # invariants: naming, versioning, etc.
    phases.yaml                # phase defs: participating shards + acceptance criteria
    VERSION                    # contract version; frozen while a phase is open
  shards/
    <shard-name>/
      SHARD.md                 # charter: what this shard PROVIDES vs CONSUMES
      CLAUDE.md                # sandbox guardrails injected for sessions opened here
      surface/                 # the shard's declared surface (what the checker diffs)
      ...shard code...
  .sharding/
    manifest.yaml              # the shard graph: dirs, provides/consumes, adapter per shard
```

Three mechanisms enforce the boundaries:

- **Validate-and-diff** (everyday): extract a shard's declared surface, diff it against its contract slice, and report drift precisely - on both the provide side and the consume side.
- **Phase gate** (at boundaries): run the drift check across every participating shard plus the phase's acceptance criteria before a phase can advance.
- **Isolation** (always): a session opened inside `shards/<name>/` may read only that directory and the read-only `contract/`, and may never write the contract. Drift and change are the same mechanical event from opposite sides - a shard diverging is drift (illegal); the conductor bumping `contract/VERSION` is change (legal, versioned), and the bump loudly invalidates every consuming shard's check.

## Layout of this repo

- `src/` - the deterministic engine (TypeScript, no framework):
  - `surface/` - the canonical shape model and the single structural differ
  - `contract/`, `manifest/` - loaders for the on-disk truth
  - `adapters/` - pluggable per-stack surface extraction (identity + jsonschema)
  - `conventions/`, `isolation/`, `check/` - convention linting, sandbox checks, per-shard check, status + blast radius, and the phase gate
  - `cli.ts` - a pure, testable dispatch over every engine operation
- `hooks/`, `commands/`, `skills/`, `.claude-plugin/` - the Claude Code plugin surface (SessionStart / PreToolUse / Stop hooks, the `/shard-*` commands, and the sharding skill)
- `examples/demo/` - a two-shard demo (`orders` provides an Order API; `gateway` consumes it) whose end-to-end test drives the real engine
- `tests/` - the test suite (49 tests across 16 files)
- `docs/design.md` - the design spec: premise, scope decisions, and the mechanism in full

## The plugin commands

Used from inside Claude Code once the plugin is installed. When installed as a plugin, the commands are namespaced under `sharding` - `/sharding:shard-check`, `/sharding:shard-status`, and so on:

| Command | Where | Does |
| --- | --- | --- |
| `/shard-init` | root | Scaffolds the conductor workspace; picks the stack/surface adapter and records it. One-time. |
| `/shard-contract` | root | Author or amend the contract, then freeze: bump `VERSION` and snapshot for the phase. Conductor-only. |
| `/shard-new <name>` | root | Registers a shard: creates `shards/<name>/` and adds it to the manifest with its provides/consumes slices. |
| `/shard-check [name]` | anywhere | Extract the shard's surface, diff against its contract slice, report drift. |
| `/shard-phase-check` | root | The gate: run `/shard-check` across all participating shards plus the phase's acceptance suite. |
| `/shard-status` | anywhere | Print the graph: shards, phase, per-shard drift, contract version, blast radius of a change. |

## The engine directly (no plugin)

The same operations are available as a plain CLI, so the workflow also works in CI or any editor:

```bash
npm install

npm run cli -- check <shard>      # diff one shard's surface against the contract
npm run cli -- status             # graph + per-shard state + blast radius
npm run cli -- phase-check        # the phase gate
npm run cli -- orient --dir <d>   # is this dir a shard or the conductor?
```

Each command exits non-zero when it finds drift or a failing gate, so it drops straight into a script.

## Development

```bash
npm install
npm test          # vitest run - full suite
npm run typecheck # tsc --noEmit
npm run build     # bundle src/cli.ts -> dist/cli.mjs (self-contained)
```

The only runtime dependency is `yaml`; everything else is dev tooling.

### The bundled CLI

The plugin's hooks and commands invoke `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`, a single self-contained bundle (esbuild, `yaml` inlined). Claude Code installs a plugin by copying it to a cache with no `node_modules`, so the engine must not depend on installed packages at run time - hence the bundle, which is committed. **Re-run `npm run build` after changing anything under `src/`,** or the installed plugin will run stale logic.

## Installing

From the robworks marketplace:

```
/plugin marketplace add ringo380/robworks-claude-code-plugins
/plugin install sharding@robworks-claude-code-plugins
```

Then reload plugins (or restart the session).

### From a local clone

This repo also doubles as a single-plugin marketplace (`.claude-plugin/marketplace.json`), so you can install and test a working copy directly:

```
/plugin marketplace add ~/git/sharding
/plugin install sharding@sharding-local
```

## Status

Proof of concept. The plugin and engine prove the mechanism end-to-end via the two-shard demo. The eventual next step - a standalone orchestrator that actively drives the shard sessions - is intentionally out of scope here.
