import { loadManifest } from "../manifest/model";
import { loadContract } from "../contract/model";
import { checkShard, type ShardCheckResult } from "./shardCheck";

export interface StatusReport {
  contractVersion: string;
  currentPhase: string;
  shards: ShardCheckResult[];
  /** Shards whose declared surface no longer matches the contract. */
  blastRadius: string[];
  /** Shards that have not acknowledged the current contract version. */
  staleShards: string[];
}

export function status(root: string): StatusReport {
  const manifest = loadManifest(root);
  const contract = loadContract(root);
  const shards = Object.keys(manifest.shards).map((name) => checkShard(root, name));
  return {
    contractVersion: contract.version,
    currentPhase: manifest.currentPhase,
    shards,
    blastRadius: shards.filter((s) => !s.clean).map((s) => s.shard),
    staleShards: shards.filter((s) => s.versionStale).map((s) => s.shard),
  };
}
