import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * The manifest is conductor-owned graph state. Per-shard acknowledgment of a
 * contract version deliberately does NOT live here - it is recorded inside the
 * shard's own directory (see src/shard/ack.ts) so acknowledging never requires
 * a shard to write outside its sandbox.
 */
export interface ShardEntry {
  dir: string;
  adapter: string;
  provides: string[];
  consumes: string[];
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
    };
  }
  return { contractVersion: raw.contractVersion, currentPhase: raw.currentPhase, shards };
}

export function shardForDir(m: Manifest, relDir: string): string | null {
  const norm = relDir.replace(/\/+$/, "");
  for (const [name, entry] of Object.entries(m.shards)) {
    if (entry.dir.replace(/\/+$/, "") === norm) return name;
  }
  return null;
}
