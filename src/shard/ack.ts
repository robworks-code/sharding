import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * A shard's acknowledgment of the contract version it was last reviewed
 * against. It lives inside the shard's own directory, alongside the surface it
 * declares, because the shard is the only party that can actually judge a
 * semantically breaking change that leaves every declared shape identical.
 *
 * Keeping the record shard-local means acknowledging never writes conductor
 * state: the manifest stays owned by the conductor, and the phase gate reads
 * this file rather than trusting a shard to have edited the graph correctly.
 */
const ACK_FILE = "ACKNOWLEDGED";

export interface ShardLocation {
  repoRoot: string;
  shardDir: string;
  shard: string;
}

/**
 * Derive the shard and repo root from a working directory.
 * Anchored to the FIRST /shards/ segment (non-greedy) so a nested "shards" dir
 * inside a shard's own subtree does not get mistaken for the repo boundary.
 * Mirrors detectShard in hooks/logic.mjs, which makes the same call for the
 * isolation hook.
 */
export function locateShard(cwd: string): ShardLocation | null {
  const m = resolve(cwd).match(/^(.*?)\/shards\/([^/]+)(?:\/|$)/);
  if (!m) return null;
  const repoRoot = m[1];
  const shard = m[2];
  return { repoRoot, shardDir: resolve(repoRoot, "shards", shard), shard };
}

/** The version this shard last acknowledged, or null if it never has. */
export function readAck(shardDir: string): string | null {
  const path = join(shardDir, "surface", ACK_FILE);
  if (!existsSync(path)) return null;
  const version = readFileSync(path, "utf8").trim();
  return version === "" ? null : version;
}

export function writeAck(shardDir: string, version: string): void {
  const dir = join(shardDir, "surface");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ACK_FILE), `${version}\n`);
}
