import { checkShard } from "./check/shardCheck";
import { status } from "./check/status";
import { checkPhase } from "./check/phaseCheck";
import { loadManifest, shardForDir } from "./manifest/model";
import { loadContract } from "./contract/model";
import { locateShard, writeAck } from "./shard/ack";
import { isReadAllowed, isWriteAllowed } from "./isolation/sandbox";
import { resolveRoot } from "./workspace/root";

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

/**
 * `cwd` is where the session actually is; conductor state is read from the
 * workspace that contains it. Commands are therefore position-independent - a
 * shard session can run a read-only check on itself without leaving its
 * directory, which is the only place it is allowed to be.
 */
export function run(argv: string[], cwd: string): { code: number; stdout: string } {
  const [cmd, ...rest] = argv;
  const j = (v: unknown) => JSON.stringify(v, null, 2);
  const root = resolveRoot(cwd);

  switch (cmd) {
    case "check": {
      // No argument means "this shard", derived from where the session is.
      const shard = rest[0] ?? locateShard(cwd)?.shard;
      if (!shard) {
        return {
          code: 1,
          stdout: j({
            checked: false,
            reason: "no shard named and not inside one: pass a shard name, or run from inside a shard",
          }),
        };
      }
      const result = checkShard(root, shard);
      return { code: result.clean ? 0 : 1, stdout: j(result) };
    }
    case "status": {
      const report = status(root);
      return { code: report.blastRadius.length === 0 ? 0 : 1, stdout: j(report) };
    }
    case "ack": {
      // Acknowledgment is the shard's own testimony about a change no shape
      // diff can see, so it is derived from where the session actually is and
      // written into that shard's directory. Nothing conductor-owned is
      // touched; the phase gate still measures the shard for real drift, so a
      // shard cannot launder drift by claiming it looked.
      const loc = locateShard(cwd);
      if (!loc) {
        return {
          code: 1,
          stdout: j({
            acknowledged: false,
            reason: "not inside a shard: a shard acknowledges itself, from its own directory",
          }),
        };
      }
      const version = loadContract(loc.repoRoot).version;
      writeAck(loc.shardDir, version);
      return { code: 0, stdout: j({ shard: loc.shard, acknowledged: true, verifiedAgainst: version }) };
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
