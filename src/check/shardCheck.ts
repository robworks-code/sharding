import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadContract } from "../contract/model";
import { loadManifest } from "../manifest/model";
import { readAck } from "../shard/ack";
import {
  extractSurface, getAdapter, surfaceExists,
  type SurfaceAdapter, type SurfaceRole,
} from "../adapters/index";
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

/**
 * Read one slice's surface, turning any failure into a finding.
 *
 * A malformed or unrepresentable surface is drift like any other: the shard
 * declared something the checker cannot match against the contract. Letting the
 * adapter's exception escape would abort the whole command, so `/shard-check`
 * would print a stack trace instead of the JSON the slash commands parse - and
 * one bad file in one shard would take down `status` and the phase gate for
 * every other shard too.
 */
function readSurface(
  adapter: SurfaceAdapter,
  shardDir: string,
  slice: string,
  role: SurfaceRole,
  root: string,
  findings: Finding[],
): StructuralSurface | null {
  try {
    return extractSurface(adapter, shardDir, slice, role);
  } catch (e: any) {
    findings.push({
      slice,
      kind: "invalid-surface",
      location: `${slice} (${role} surface at ${relative(root, adapter.locate(shardDir, slice, role))})`,
      actual: String(e?.message ?? e),
    });
    return null;
  }
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
    if (!surfaceExists(adapter, shardDir, slice, "provided")) {
      findings.push({
        slice,
        kind: "missing-symbol",
        location: `${slice} (no provided surface at ${relative(root, adapter.locate(shardDir, slice, "provided"))})`,
      });
      continue;
    }
    const extracted = readSurface(adapter, shardDir, slice, "provided", root, findings);
    if (!extracted) continue;
    findings.push(...diffSurface(expected, extracted));
    findings.push(...lintConventions(extracted, rules));
  }

  for (const slice of entry.consumes) {
    const expected = contract.slices[slice];
    if (!expected) {
      findings.push({ slice, kind: "missing-symbol", location: slice });
      continue;
    }
    // Read through the adapter, not a hardcoded path: a shard declares what it
    // consumes in the same terms it declares what it provides. Hardcoding the
    // identity layout here made a jsonschema shard write two different formats.
    if (!surfaceExists(adapter, shardDir, slice, "consumed")) {
      findings.push({
        slice,
        kind: "missing-symbol",
        location: `${slice} (no consumed snapshot at ${relative(root, adapter.locate(shardDir, slice, "consumed"))})`,
      });
      continue;
    }
    const snapshot = readSurface(adapter, shardDir, slice, "consumed", root, findings);
    if (!snapshot) continue;
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
