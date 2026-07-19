import { checkShard } from "./check/shardCheck";
import { status } from "./check/status";
import { checkPhase } from "./check/phaseCheck";
import { ackShardVersion, loadManifest, shardForDir } from "./manifest/model";
import { loadContract } from "./contract/model";
import { isReadAllowed, isWriteAllowed } from "./isolation/sandbox";

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

export function run(argv: string[], root: string): { code: number; stdout: string } {
  const [cmd, ...rest] = argv;
  const j = (v: unknown) => JSON.stringify(v, null, 2);

  switch (cmd) {
    case "check": {
      const result = checkShard(root, rest[0]);
      return { code: result.clean ? 0 : 1, stdout: j(result) };
    }
    case "status": {
      const report = status(root);
      return { code: report.blastRadius.length === 0 ? 0 : 1, stdout: j(report) };
    }
    case "ack": {
      const shard = rest[0];
      const result = checkShard(root, shard);
      // Acknowledging a drifted shard would launder real drift into a green
      // stamp, so the shard must conform before it can claim it looked.
      if (!result.clean) {
        return {
          code: 1,
          stdout: j({
            shard,
            acknowledged: false,
            reason: "shard has drift; resolve it before acknowledging the contract version",
            findings: result.findings,
          }),
        };
      }
      const version = loadContract(root).version;
      ackShardVersion(root, shard, version);
      return { code: 0, stdout: j({ shard, acknowledged: true, verifiedAgainst: version }) };
    }
    case "phase-check": {
      const result = checkPhase(root);
      return { code: result.passed ? 0 : 1, stdout: j(result) };
    }
    case "sandbox-check": {
      const f = flags(rest);
      const allowed = f.mode === "write"
        ? isWriteAllowed(f["shard-dir"], f["contract-dir"], f.target)
        : isReadAllowed(f["shard-dir"], f["contract-dir"], f.target);
      return { code: allowed ? 0 : 1, stdout: j({ allowed }) };
    }
    case "orient": {
      const f = flags(rest);
      const manifest = loadManifest(root);
      const shard = shardForDir(manifest, f.dir);
      if (!shard) return { code: 0, stdout: j({ role: "conductor" }) };
      const entry = manifest.shards[shard];
      return { code: 0, stdout: j({ role: "shard", shard, consumes: entry.consumes }) };
    }
    default:
      return { code: 2, stdout: j({ error: `unknown command: ${cmd}` }) };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { code, stdout } = run(process.argv.slice(2), process.cwd());
  process.stdout.write(stdout + "\n");
  process.exit(code);
}
