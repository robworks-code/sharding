# Sharding

Build a large software product as a set of deliberately separated components ("shards"), each developed in its own isolated [Claude Code](https://claude.com/claude-code) session, coupled only through a frozen, versioned **contract**, and integrated in phases where each phase produces a provably integrable deliverable.

This repository is the proof-of-concept: a Claude Code plugin plus the deterministic engine underneath it.

**[robworks-code.github.io/sharding](https://robworks-code.github.io/sharding/)** walks through the whole idea top to bottom: the failure mode it addresses, the mechanism, and the two-shard demo with real output.

## The idea

The premise is that **LLM inconsistency is a given, not something to hope away**. The system never asks a session to "remember" the whole product. Instead it makes the shared truth external, small, and mechanically enforced:

- A shard can only ever see its own slice plus a read-only copy of the contract.
- Any divergence from the contract is caught by deterministic tooling at a gate - the same way a type error blocks a build, not by an agent noticing.

> The thesis under test: N independently-driven, isolated shards, coupled only through a frozen contract and gated mechanically, will snap together into an integrable deliverable at each phase - despite each session being individually forgetful.

## Quick start

### Install the plugin

```
/plugin marketplace add ringo380/robworks-claude-code-plugins
/plugin install sharding@robworks-claude-code-plugins
```

Reload plugins (or restart the session) and the `/shard-*` commands are available. (Full install options, including from a local clone, are [below](#installing).)

### See it work first - no setup

The two-shard demo drives the real engine end to end: `orders` provides an Order API, `gateway` consumes it.

```bash
git clone https://github.com/robworks-code/sharding
cd sharding && npm install
npm test                                        # the demo's end-to-end test runs as part of the suite
cd examples/demo && node ../../dist/cli.mjs status   # inspect the demo's shard graph directly
```

`status` prints the graph - both shards, the current phase, per-shard drift, and the contract version - all clean.

### Use it on your own project

Open Claude Code in the directory you want to orchestrate. As the conductor:

1. **`/shard-init`** - scaffold the conductor workspace and pick your stack's surface adapter. One time.
2. **`/shard-contract`** - author the shared interfaces, schemas, and conventions, then freeze them (bumps `contract/VERSION`).
3. **`/shard-new <name>`** - register each shard with the slices it provides and consumes.

Then build each shard in its **own isolated session**: open Claude Code inside `shards/<name>/`, where it can see only that directory plus the read-only `contract/`, and develop against the contract. At any point:

- **`/shard-check`** - diff this shard's surface against the contract and report drift.
- **`/shard-ack`** - acknowledge the current contract version after a bump, once you have reviewed what changed.
- **`/shard-phase-check`** - the gate: every participating shard clean, plus the phase's acceptance suite green, before the phase can advance.
- **`/shard-status`** - the whole graph, per-shard drift, and the blast radius of a change.

The [full command reference](#the-plugin-commands) and the [standalone CLI](#the-engine-directly-no-plugin) are below.

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
        <slice>.json           # one per PROVIDED slice
        consumed/<slice>.json  # snapshot of each CONSUMED slice, as built against
        ACKNOWLEDGED           # contract version this shard last reviewed itself against
      ...shard code...
  .sharding/
    manifest.yaml              # the shard graph: dirs, provides/consumes, adapter per shard
```

Three mechanisms enforce the boundaries:

- **Validate-and-diff** (everyday): extract a shard's declared surface, diff it against its contract slice, and report drift precisely - on both the provide side and the consume side.
- **Phase gate** (at boundaries): run the drift check across every participating shard plus the phase's acceptance criteria before a phase can advance.
- **Isolation** (always): a session opened inside `shards/<name>/` may read only that directory and the read-only `contract/`, and may never write the contract. Drift and change are the same mechanical event from opposite sides - a shard diverging is drift (illegal); the conductor bumping `contract/VERSION` is change (legal, versioned). A bump propagates two ways: structurally, as drift findings for any shard whose shape no longer matches, and by version, marking every shard stale until it explicitly acknowledges the new contract. The second channel catches changes a shape diff cannot see - a narrowed enum, a tightened rule - and blocks the phase gate rather than interrupting shards mid-task.

## Layout of this repo

- `src/` - the deterministic engine (TypeScript, no framework):
  - `surface/` - the canonical shape model and the single structural differ
  - `contract/`, `manifest/` - loaders for the on-disk truth
  - `adapters/` - pluggable per-stack surface extraction (identity + jsonschema)
  - `conventions/`, `isolation/`, `check/` - convention linting, sandbox checks, per-shard check, status + blast radius, and the phase gate
  - `cli.ts` - a pure, testable dispatch over every engine operation
- `hooks/`, `commands/`, `skills/`, `.claude-plugin/` - the Claude Code plugin surface (SessionStart / PreToolUse / Stop hooks, the `/shard-*` commands, and the sharding skill)
- `examples/demo/` - a two-shard demo (`orders` provides an Order API; `gateway` consumes it) whose end-to-end test drives the real engine
- `tests/` - the test suite (87 tests across 18 files)
- `docs/design.md` - the design spec: premise, scope decisions, and the mechanism in full

## The plugin commands

Used from inside Claude Code once the plugin is installed. When installed as a plugin, the commands are namespaced under `sharding` - `/sharding:shard-check`, `/sharding:shard-status`, and so on:

| Command | Where | Does |
| --- | --- | --- |
| `/shard-init` | root | Scaffolds the conductor workspace; picks the stack/surface adapter and records it. One-time. |
| `/shard-contract` | root | Author or amend the contract, then freeze: bump `VERSION` and snapshot for the phase. Conductor-only. |
| `/shard-new <name>` | root | Registers a shard: creates `shards/<name>/` and adds it to the manifest with its provides/consumes slices. |
| `/shard-check [name]` | anywhere | Extract the shard's surface, diff against its contract slice, report drift. |
| `/shard-ack` | shard | Acknowledge this shard against the current contract version, after reviewing what the bump changed. Records into the shard's own directory. |
| `/shard-phase-check` | anywhere | The gate: run `/shard-check` across all participating shards plus the phase's acceptance suite. |
| `/shard-status` | anywhere | Print the graph: shards, phase, per-shard drift, contract version, blast radius of a change. |

## The engine directly (no plugin)

The same operations are available as a plain CLI, so the workflow also works in CI or any editor:

```bash
npm install

npm run cli -- check [shard]      # diff one shard's surface against the contract
npm run cli -- status             # graph + per-shard state + blast radius + stale shards
npm run cli -- phase-check        # the phase gate
npm run cli -- orient --dir <d>   # is this dir a shard or the conductor?
```

Every command finds the workspace from the working directory, so they run from the
conductor root, from inside a shard, or from any directory under either. `check` with
no shard name checks the shard you are inside.

`ack` is the exception to the `npm run` form: it derives the shard from the working
directory, and `npm run` resets that to the package root. Invoke it directly, from
inside the shard:

```bash
cd shards/<name> && node /path/to/sharding/dist/cli.mjs ack
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

## License

Source-available under the [Business Source License 1.1](LICENSE), not open source (yet).

**If you are a developer, use it.** The Additional Use Grant covers production use by any
individual acting on their own initiative - including work for an employer or client of
any size, and work you get paid for. Your employer's headcount does not matter. Read it,
fork it, modify it, use it on real work.

**If your organization adopts it, that needs a commercial license.** The line is
individual use versus organizational adoption: standardizing on it across a team,
deploying it as shared infrastructure, or running it in automated systems on the
organization's behalf. As a concrete safe harbor, up to five individuals within one
organization, each acting on their own initiative, are covered by the grant - so a team
can pilot it before anyone has to ask anyone for permission. For a commercial license,
contact <licensing@robworks.info>.

**It becomes MIT on 2030-07-19.** BUSL converts each version to the Change License on its
Change Date, so this is a delay on open source, not a refusal of it.

The prebuilt CLI at `dist/cli.mjs` bundles [yaml](https://github.com/eemeli/yaml) (ISC).
See [NOTICE](NOTICE).

## Status

Proof of concept. The plugin and engine prove the mechanism end-to-end via the two-shard demo. The eventual next step - a standalone orchestrator that actively drives the shard sessions - is intentionally out of scope here.
