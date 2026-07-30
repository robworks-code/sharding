import { loadManifest, type Manifest } from "../manifest/model";
import { loadPhases } from "../check/phaseCheck";

/**
 * Execution planning for the orchestrator.
 *
 * Shards couple only through the contract, so in principle every shard could
 * run at once. In practice a consumer is far more useful once the slice it
 * consumes has actually been built, so the plan orders shards into waves: a
 * shard waits for the shards providing what it consumes, and everything within
 * a wave is independent by construction and runs in parallel.
 *
 * Note this ordering is a scheduling convenience, NOT a correctness mechanism.
 * Correctness comes from the frozen contract - which is why a dependency cycle
 * is reported rather than treated as fatal: shards in a cycle are still
 * perfectly legal (two shards may consume each other's slices), they simply
 * have no meaningful order, so they are scheduled together in a final wave.
 */

export interface Wave {
  index: number;
  shards: string[];
}

export interface OrchestrationPlan {
  phase: string;
  contractVersion: string;
  waves: Wave[];
  /** Shards genuinely on a dependency cycle, so they have no relative order. */
  cyclic: string[];
  /** Shards not on a cycle, but blocked behind one. */
  blocked: string[];
  /** Slices consumed in this phase that no participating shard provides. */
  unprovided: Array<{ shard: string; slice: string }>;
}

function providersOf(manifest: Manifest, participants: Set<string>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const name of participants) {
    for (const slice of manifest.shards[name].provides) {
      map.set(slice, [...(map.get(slice) ?? []), name]);
    }
  }
  return map;
}

export function planPhase(root: string): OrchestrationPlan {
  const manifest = loadManifest(root);
  const phase = loadPhases(root).find((p) => p.id === manifest.currentPhase);
  if (!phase) throw new Error(`no phase spec for ${manifest.currentPhase}`);

  for (const name of phase.shards) {
    if (!manifest.shards[name]) {
      throw new Error(`phase ${phase.id} names shard "${name}", which is not in the manifest`);
    }
  }

  const participants = new Set(phase.shards);
  const providers = providersOf(manifest, participants);
  const unprovided: Array<{ shard: string; slice: string }> = [];

  // deps[shard] = the participating shards it must follow.
  const deps = new Map<string, Set<string>>();
  for (const name of participants) {
    const set = new Set<string>();
    for (const slice of manifest.shards[name].consumes) {
      const provs = providers.get(slice);
      if (!provs) {
        // Not an error: the slice may be provided by a shard outside this
        // phase, or by nothing yet. The phase gate is what judges that - the
        // planner only reports it so the conductor is not surprised.
        unprovided.push({ shard: name, slice });
        continue;
      }
      for (const p of provs) if (p !== name) set.add(p);
    }
    deps.set(name, set);
  }

  const waves: Wave[] = [];
  const placed = new Set<string>();
  let remaining = [...participants];

  while (remaining.length > 0) {
    const ready = remaining.filter((name) => [...deps.get(name)!].every((d) => placed.has(d)));
    if (ready.length === 0) break; // everything left is in a cycle
    waves.push({ index: waves.length, shards: [...ready].sort() });
    for (const name of ready) placed.add(name);
    remaining = remaining.filter((name) => !placed.has(name));
  }

  // Everything still unplaced is blocked, but only some of it is actually in a
  // cycle - the rest merely depends on something that is. Reporting a
  // downstream shard as "cyclic" tells the conductor to go looking for a cycle
  // it is not part of, so the two are separated.
  const stuck = new Set(remaining);
  const onCycle = (name: string): boolean => {
    const seen = new Set<string>();
    const reaches = (from: string): boolean => {
      for (const dep of deps.get(from) ?? []) {
        if (!stuck.has(dep)) continue;
        if (dep === name) return true;
        if (!seen.has(dep)) {
          seen.add(dep);
          if (reaches(dep)) return true;
        }
      }
      return false;
    };
    return reaches(name);
  };

  const cyclic = remaining.filter(onCycle).sort();
  const blocked = remaining.filter((n) => !cyclic.includes(n)).sort();
  if (remaining.length > 0) waves.push({ index: waves.length, shards: [...remaining].sort() });

  return { phase: phase.id, contractVersion: phase.contractVersion, waves, cyclic, blocked, unprovided };
}
