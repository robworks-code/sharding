import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract } from "../contract/model";
import { loadManifest } from "../manifest/model";
import { readAck } from "../shard/ack";
import { getAdapter } from "../adapters/index";
import { diffSurface } from "../surface/diff";
import { lintConventions, type ConventionRules } from "../conventions/lint";
import type { Finding, StructuralSurface } from "../surface/types";

export interface ShardCheckResult {
  shard: string;
  /** Structural conformance only. Staleness is deliberately not drift. */
  clean: boolean;
  findings: Finding[];
  contractVersion: string;
  verifiedAgainst: string;
  versionStale: boolean;
}

export function checkShard(root: string, shardName: string): ShardCheckResult {
  const manifest = loadManifest(root);
  const contract = loadContract(root);
  const entry = manifest.shards[shardName];
  if (!entry) throw new Error(`unknown shard: ${shardName}`);
  const shardDir = join(root, entry.dir);
  const findings: Finding[] = [];

  const rulesPath = join(root, "contract", "conventions.json");
  const rules: ConventionRules = existsSync(rulesPath) ? JSON.parse(readFileSync(rulesPath, "utf8")) : {};
  const adapter = getAdapter(entry.adapter);

  for (const slice of entry.provides) {
    const expected = contract.slices[slice];
    if (!expected) {
      findings.push({ slice, kind: "missing-symbol", location: slice });
      continue;
    }
    if (!adapter.exists(shardDir, slice)) {
      findings.push({ slice, kind: "missing-symbol", location: `${slice} (no provided surface)` });
      continue;
    }
    const extracted = adapter.extract(shardDir, slice);
    findings.push(...diffSurface(expected, extracted));
    findings.push(...lintConventions(extracted, rules));
  }

  for (const slice of entry.consumes) {
    const expected = contract.slices[slice];
    if (!expected) {
      findings.push({ slice, kind: "missing-symbol", location: slice });
      continue;
    }
    const snapPath = join(shardDir, "surface", "consumed", `${slice}.json`);
    if (!existsSync(snapPath)) {
      findings.push({ slice, kind: "missing-symbol", location: `${slice} (no consumed snapshot)` });
      continue;
    }
    const snapshot = JSON.parse(readFileSync(snapPath, "utf8")) as StructuralSurface;
    findings.push(...diffSurface(expected, snapshot));
  }

  // A shard is measured against the version it last acknowledged, which it
  // records in its own directory. Without an explicit acknowledgment the
  // manifest's contractVersion is the baseline, so a conductor bump goes stale
  // for every shard that hasn't looked at it.
  const verifiedAgainst = readAck(shardDir) ?? manifest.contractVersion;

  return {
    shard: shardName,
    clean: findings.length === 0,
    findings,
    contractVersion: contract.version,
    verifiedAgainst,
    versionStale: verifiedAgainst !== contract.version,
  };
}
