# Sharding - Design Spec

**Created**: 2026-07-18
**Status**: Implemented. This document is the design record for the proof of concept;
the README and the project site describe current behavior.

## Overview

Sharding is a Claude Code plugin (proof of concept) for building a large software
product as a set of deliberately separated components ("shards"), each developed in
its own isolated Claude Code session, coupled only through a frozen, versioned
contract, and integrated in phases where each phase produces a provably integrable
deliverable.

The core premise is that **LLM inconsistency is a given, not a thing to hope away**.
The system never asks a session to "remember" the whole product. Instead it makes the
shared truth **external, small, and mechanically enforced**: a shard can only ever see
its own slice plus a read-only contract, and any divergence from that contract is
caught by deterministic tooling at a gate - the same way a type error blocks a build.
If the proof of concept holds, the natural progression is a standalone
CLI/orchestrator (out of scope here).

### The thesis under test

> N independently-driven, isolated Claude Code shards, coupled only through a frozen
> contract and gated mechanically, will snap together into an integrable deliverable at
> each phase - despite each session being individually forgetful.

## Scope decisions

- **Output**: a Claude Code plugin (commands + skill + hooks). Proof of concept. A
  standalone orchestrator is the eventual next step, explicitly out of scope.
- **Work model**: source-of-truth lives on disk, sessions are disposable. Contracts are
  frozen in a conductor session; shards can then be developed as independent top-level
  sessions *or* as subagents. No live conductor is required for a shard to work.
- **Layout**: plain parent/child folders - conductor at the repo root, `shards/<name>/`
  beneath.
- **What stays consistent (the contract is made of):**
  - (A) Interfaces/APIs - signatures, endpoints, message/event schemas
  - (B) Data shapes - shared types, schemas, serialization formats, enums
  - (C) Shared invariants - auth model, error conventions, naming, versioning rules
  - (D) Phase deliverable definitions - acceptance criteria proving shards integrate
- **Enforcement mode**: validate-and-diff (B) as the everyday mechanism, phase gate (C)
  at boundaries, generate-and-import (A) opportunistically where a stack makes codegen
  cheap.
- **Shard visibility**: own slice + read-only contract only (maximum isolation). All
  cross-shard coupling is forced through the contract.
- **Gate strength**: both on-demand commands *and* a blocking hook. Commands make it
  usable; the hook makes it trustworthy.
- **Surface extraction**: declared-surface diffing via pluggable per-stack adapters.
  Stack choice is made during onboarding, not hardcoded.

## Architecture

### The substrate (filesystem)

```
project-root/                     # conductor workspace (open Claude Code here to orchestrate)
  contract/                       # THE frozen truth. Read-only to shards (hook-enforced).
    interfaces/                   # APIs, function sigs, endpoints, event names   (A)
    schemas/                      # shared data shapes: JSON Schema / shared types (B)
    conventions.md                # invariants in prose: auth, errors, naming, versioning (C)
    conventions.json              # the checkable subset of those, enforced by the linter
    phases.yaml                   # phase defs + participating shards + acceptance criteria (D)
    VERSION                       # contract version; frozen per phase
  shards/
    <shard-name>/
      SHARD.md                    # charter: purpose, contract slices PROVIDED vs CONSUMED, boundaries
      CLAUDE.md                   # sandbox guardrails injected for sessions opened here
      surface/                    # the shard's DECLARED provided surface (what the checker diffs)
        <slice>.json              # one per PROVIDED slice
        consumed/<slice>.json     # snapshot of each CONSUMED slice, as built against
        ACKNOWLEDGED              # contract version this shard last reviewed itself against
      ...shard code...
  .sharding/
    manifest.yaml                 # the shard graph: names, dirs, provides/consumes map, adapter per shard
  CLAUDE.md                       # conductor guidance (root)
```

Three core artifacts do all the work:

1. **Contract** - small, external, frozen, versioned. The *only* thing a shard may
   couple to.
2. **Manifest** (`.sharding/manifest.yaml`) - the graph: for each shard, which contract
   slices it **provides** and which it **consumes**, plus which surface-adapter it uses.
   Tells the checker what each shard is on the hook for.
3. **Declared surface** (`shards/<name>/surface/`) - each shard commits a
   machine-checkable statement of what it exposes. The checker diffs this against the
   contract slice the manifest says it provides.

The thesis in one line: **a shard can only ever see `shards/<self>/` + read-only
`contract/`; all cross-shard coupling is forced through the frozen contract, and drift
from it is caught mechanically.**

### Plugin components

**Commands** (conductor/human-facing verbs):

| Command | Where | Does |
|---|---|---|
| `/shard-init` | root | Scaffolds the conductor workspace; asks the stack/surface-format question and records the chosen adapter(s) in the manifest. One-time. |
| `/shard-contract` | root | Author or amend the contract, then **freeze**: bump `contract/VERSION`, snapshot for the current phase, regenerate any A-style codegen. Conductor-only. |
| `/shard-new <name>` | root | Registers a shard: creates `shards/<name>/` with `SHARD.md` + sandbox `CLAUDE.md` + empty `surface/`; adds it to the manifest with its provides/consumes slices and adapter. |
| `/shard-check [name]` | anywhere | Mechanism **B**: extract/read the shard's declared surface, diff against its contract slice, report drift precisely. Checks both provide-side and consume-side. |
| `/shard-ack` | shard | Acknowledge this shard against the current contract version after reviewing what the bump changed. Records into the shard's own `surface/ACKNOWLEDGED`; clears the staleness that blocks the phase gate. |
| `/shard-phase-check` | anywhere | The gate (**C/D**): run `/shard-check` across all participating shards + the phase's integration/acceptance suite from `phases.yaml`. |
| `/shard-status` | anywhere | Prints the graph: shards, current phase, per-shard drift/clean state, contract version, blast radius after a change. |

"Where" is workflow guidance, not a mechanism: the engine locates the workspace from
the working directory, so the read-only commands run from any directory under it. The
shard boundary takes precedence over the ancestor search, so a shard holding its own
`.sharding/` cannot redefine which graph it is measured against. Writes stay governed
by the isolation hook, which is what actually keeps a shard inside its sandbox.

**Skill** - `sharding`: teaches any session the workflow and conventions (how to author
a contract, declare a surface, work inside a shard). Lets a fresh disposable session
self-orient without re-explanation.

**Hooks** (the deterministic backstop - the reason this is a plugin, not a convention):

- **`SessionStart`** - detect cwd. Inside `shards/<name>/`: inject that shard's charter +
  its consumed contract slices + the isolation rule. At root: inject conductor context.
  This is how disposable sessions re-orient from files, not memory.
- **`PreToolUse`** (Read/Edit/Write/NotebookEdit) - if the session is sandboxed to a
  shard: **deny reads/writes reaching outside `shards/<self>/` and read-only
  `contract/`**, and **deny any write into `contract/`** from a shard. Makes "can only
  see its slice" real for the file tools.
  **Known limit:** `Bash` is not gated. Deciding what an arbitrary shell command touches
  means parsing shell, which is unreliable enough that a partial check would be worse
  than none - it would read as a guarantee while leaking. So the design does not lean on
  it: no workflow step requires a shard to write conductor state, which is why
  acknowledgment is recorded shard-locally rather than in the manifest. A shard that
  shells out to escape its sandbox is defeating a boundary it is not asked to cross, and
  the phase gate still measures its surface independently either way.
- **`Stop`** - run `/shard-check` for the current shard when it tries to
  wrap up. **If it drifted from the frozen contract, block the completion claim** and
  surface the drift report.

**Enforcement stack, top to bottom (every layer deterministic; none relies on memory):**

1. `PreToolUse` isolation - a shard can't wander out of its slice while working.
2. `/shard-check` (B) - fast, local, deterministic drift detection on demand.
3. `Stop` hook - drift can't be declared complete.
4. `/shard-phase-check` (C/D) - shards provably snap together before a phase closes.
5. Contract codegen (A) - opportunistic hardest guarantee where a stack makes it cheap.

### The checker (declared-surface diffing)

A `/shard-check` run:

1. Read the manifest: this shard **provides** slices `[X, Y]`, **consumes** `[Z]`, uses
   adapter `<adapter>`.
2. **Provide-side diff**: read `shards/<name>/surface/` and diff it *structurally*
   against `contract/interfaces/` + `contract/schemas/` for X, Y. Missing member, renamed
   field, changed type, dropped endpoint, altered event name = a drift finding with a
   precise location.
3. **Consume-side check**: confirm the shard's declared expectations of Z still match the
   current frozen contract (catches the contract changing under a shard that wasn't
   looking).
4. **Convention lint**: apply the checkable rules in `conventions.json` (naming, error
   envelope shape, version tags) to the surface.
5. Emit a structured report: `clean`, or a list of `{slice, kind, expected, actual,
   location}`.

The diff is **structural, not textual** - comparing declared shapes, not eyeballing
files - which is what makes it deterministic regardless of how the LLM wrote the code.

**Why declared-surface rather than parsing code:** for stacks where the surface is a
machine-derived artifact (OpenAPI from the framework, `tsc --emitDeclarationOnly`,
exported JSON Schema, protobuf), the declaration cannot lie without the build lying. And
the phase gate's integration suite exercises shards against each other, so a surface that
misrepresents real behavior fails there. Declaration catches drift early and cheaply;
integration catches lies at the gate.

### Surface adapters (the extensible edge)

- The checker core is **adapter-agnostic**: it only diffs two structural surfaces.
- Each **adapter** turns a shard's real output into a structural surface for its stack.
- **Stack choice happens at onboarding** (`/shard-init`), is recorded per-shard in the
  manifest, and selects the adapter. Projects may be **multi-stack** - each shard diffs
  against the same contract in its own terms.
- Stacks with no adapter yet degrade honestly to **gate-only (mechanism C)** rather than
  faking a green check.

## Contract evolution + phase lifecycle

**Drift and change are the same mechanical event from opposite sides.** A shard
diverging from a frozen contract = drift (illegal). The conductor deliberately altering
the contract = change (legal, versioned). The system distinguishes them by **who may
touch `contract/`** (hook-enforced: conductor only) and **whether the version was
bumped**.

**Frozen per phase:** a phase in `phases.yaml` pins a contract version + participating
shards + acceptance criteria. While a phase is open, `contract/VERSION` is frozen; every
check diffs against that version, so the target never moves under a working shard.

**When the contract must change:**

1. Only the conductor can (`PreToolUse` denies shard writes to `contract/`).
   `/shard-contract` amends and **bumps the version**.
2. The bump propagates through **two independent channels**:
   - **Structural**: any shard whose declared surface no longer matches the new contract
     shape reports drift, with the precise field. This is the everyday case.
   - **Version**: every shard is marked **stale** until it explicitly acknowledges the new
     version. This catches changes that are semantically breaking but structurally
     invisible - a narrowed enum, a tightened validation rule, a redefined unit - which a
     shape diff cannot see by construction.
3. `/shard-status` shows both: `blastRadius` (shards that actually drifted) and
   `staleShards` (shards that have not acknowledged the current version).
4. Staleness is **not** drift and deliberately does not fail `/shard-check` or block the
   Stop hook - a bump should not interrupt every shard mid-task. It blocks at
   `/shard-phase-check`, because a phase cannot be "provably integrable" while a
   participating shard was never checked against the version the phase froze.
5. Clearing it is deliberate: the shard runs `/shard-ack` in its own session, which
   records the version into that shard's `surface/ACKNOWLEDGED`. A clean structural diff
   alone never re-blesses a shard, since that is precisely the case the version channel
   exists to catch.

**Why the shard acknowledges itself.** The changes this channel exists to catch are the
ones a shape diff cannot see, so deciding whether a shard is still conformant means
reading that shard's implementation. The conductor deliberately does not hold that - it
owns the graph, not the internals - so a conductor-side acknowledgment would be a blind
stamp, strictly less informative than an informed one. The shard is the only party in a
position to testify.

That testimony is not trusted as proof. `/shard-phase-check` independently measures every
participating shard for real structural drift, so an acknowledgment cannot launder a
structural problem into a green gate. It clears exactly one thing: "this shard looked at
version N."

Keeping the record shard-local also keeps the isolation invariant intact. The manifest
stays conductor-owned, and acknowledging requires no write outside the shard's own
sandbox. A shard with no record falls back to the manifest's top-level `contractVersion`
as its baseline.

**Lifecycle:**

```
open phase  -> freeze contract vN, declare participating shards + acceptance criteria
   |
shards work in isolation, each converging to vN via /shard-check + Stop-hook gate
   |
/shard-phase-check  -> all provide-side diffs clean
                    +  all consume-side checks clean
                    +  all participating shards acknowledged the frozen version
                    +  phase integration/acceptance suite green
   |  (only if all pass)
close phase -> tag the integrable snapshot; contract vN becomes the baseline for phase N+1
```

Consequences worth naming:
- Contract changes are **versioned events with a computed blast radius** - the thing
  humans lose track of becomes a mechanical query.
- A phase closes **only when provably integrable** - `/shard-phase-check` is the
  deterministic definition of "done and snaps together."

## Success criteria (what the PoC must demonstrate)

1. A shard session **physically cannot** read another shard's internals or write the
   contract (PreToolUse denials fire).
2. A shard that drifts from the frozen contract **cannot declare itself done** (Stop hook
   blocks with a precise finding).
3. A deliberate contract change **automatically surfaces its exact blast radius** across
   consuming shards (`/shard-status`).
4. `/shard-phase-check` goes green **only** when all shards actually integrate, and the
   resulting snapshot really runs.
5. All of the above hold across **disposable sessions** - close every session, reopen
   fresh ones, and the on-disk source-of-truth fully re-orients them.

If 1-5 hold, the plugin has proven the thesis and a standalone orchestrator (C) is
justified. If they don't, the failing layer is identified precisely.

## Illustrative walkthrough (2-shard demo)

```
1. Conductor (root):  /shard-init        -> picks stack, scaffolds contract/ + shards/
2. Conductor:         /shard-contract     -> defines interface "OrderAPI" + schema "Order",
                                            conventions, phase-1 acceptance = "gateway can place an order";
                                            freeze v1
3. Conductor:         /shard-new gateway   (consumes OrderAPI)
                      /shard-new orders     (provides OrderAPI + Order schema)
4. FRESH session in shards/orders/  -> SessionStart injects charter + contract slice + isolation.
                      Builds service, emits surface/. Tries to finish.
                      Stop hook runs /shard-check -> surface matches OrderAPI v1 -> allowed done.
5. FRESH session in shards/gateway/ -> builds against Order/OrderAPI seen only via contract/.
                      Tries to read shards/orders/ internals -> PreToolUse DENIES.
6. Conductor:         /shard-phase-check   -> both diffs clean + integration test green -> phase 1 closes, snapshot tagged.
7. Stress:            /shard-contract adds a required field to Order, bump v2.
                      /shard-status        -> gateway + orders flagged. Blast radius computed, not remembered. Fix, re-gate.
```

Step 7 is the real proof: the moment a human org starts losing threads, the system
computes who is affected.

## Open questions / deferred

- Exact `manifest.yaml` and `phases.yaml` schemas (settle during implementation planning).
- Which single stack/adapter ships first with the PoC (build-order decision, not a design
  default - the architecture assumes no language).
- Structural-diff representation shared across adapters (the intermediate "structural
  surface" format).
- Standalone orchestrator (C) - explicitly out of scope for this PoC.
