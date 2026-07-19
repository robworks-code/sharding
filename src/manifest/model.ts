import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, parseDocument } from "yaml";

export interface ShardEntry {
  dir: string;
  adapter: string;
  provides: string[];
  consumes: string[];
  /**
   * Contract version this shard was last explicitly acknowledged against.
   * Absent means it has never been acknowledged, in which case the manifest's
   * top-level contractVersion is the effective baseline.
   */
  verifiedAgainst?: string;
}

export interface Manifest {
  contractVersion: string;
  currentPhase: string;
  shards: Record<string, ShardEntry>;
}

export function loadManifest(root: string): Manifest {
  const path = join(root, ".sharding", "manifest.yaml");
  if (!existsSync(path)) throw new Error(`no manifest at ${path}`);
  const raw = parse(readFileSync(path, "utf8")) as any;
  const shards: Record<string, ShardEntry> = {};
  for (const [name, entry] of Object.entries((raw.shards ?? {}) as Record<string, any>)) {
    shards[name] = {
      dir: entry.dir,
      adapter: entry.adapter,
      provides: entry.provides ?? [],
      consumes: entry.consumes ?? [],
      ...(entry.verifiedAgainst ? { verifiedAgainst: String(entry.verifiedAgainst) } : {}),
    };
  }
  return { contractVersion: raw.contractVersion, currentPhase: raw.currentPhase, shards };
}

/**
 * Stamp a shard as acknowledged against a contract version.
 * Uses the YAML document API so comments and formatting elsewhere in the
 * manifest survive the rewrite.
 */
export function ackShardVersion(root: string, shardName: string, version: string): void {
  const path = join(root, ".sharding", "manifest.yaml");
  if (!existsSync(path)) throw new Error(`no manifest at ${path}`);
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.getIn(["shards", shardName]) === undefined) {
    throw new Error(`unknown shard: ${shardName}`);
  }
  doc.setIn(["shards", shardName, "verifiedAgainst"], version);
  writeFileSync(path, doc.toString());
}

export function shardForDir(m: Manifest, relDir: string): string | null {
  const norm = relDir.replace(/\/+$/, "");
  for (const [name, entry] of Object.entries(m.shards)) {
    if (entry.dir.replace(/\/+$/, "") === norm) return name;
  }
  return null;
}
