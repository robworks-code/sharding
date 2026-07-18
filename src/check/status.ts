import { loadManifest } from "../manifest/model";
import { loadContract } from "../contract/model";
import { checkShard, type ShardCheckResult } from "./shardCheck";

export interface StatusReport {
  contractVersion: string;
  currentPhase: string;
  shards: ShardCheckResult[];
  blastRadius: string[];
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
  };
}
