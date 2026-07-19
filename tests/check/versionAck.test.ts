import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkShard } from "../../src/check/shardCheck";
import { checkPhase } from "../../src/check/phaseCheck";
import { status } from "../../src/check/status";
import { locateShard, readAck, writeAck } from "../../src/shard/ack";
import { run } from "../../src/cli";

const ORDER = {
  slice: "Order",
  symbols: {
    Order: {
      name: "Order",
      kind: "type",
      shape: { kind: "object", fields: { id: { type: { kind: "primitive", name: "string" }, required: true } } },
    },
  },
};

/** Conductor workspace with one clean shard, contract frozen at v1. */
function scaffold(opts: { acknowledged?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "vack-"));
  mkdirSync(join(root, "contract", "schemas"), { recursive: true });
  mkdirSync(join(root, ".sharding"), { recursive: true });
  mkdirSync(join(root, "shards", "orders", "surface"), { recursive: true });
  writeFileSync(join(root, "contract", "VERSION"), "v1");
  writeFileSync(join(root, "contract", "schemas", "order.json"), JSON.stringify(ORDER));
  writeFileSync(join(root, "shards", "orders", "surface", "Order.json"), JSON.stringify(ORDER));
  if (opts.acknowledged) {
    writeFileSync(join(root, "shards", "orders", "surface", "ACKNOWLEDGED"), `${opts.acknowledged}\n`);
  }
  writeFileSync(
    join(root, ".sharding", "manifest.yaml"),
    "contractVersion: v1\ncurrentPhase: phase-1\nshards:\n  orders:\n    dir: shards/orders\n    adapter: identity\n    provides: [Order]\n",
  );
  writeFileSync(
    join(root, "contract", "phases.yaml"),
    "phases:\n  - id: phase-1\n    contractVersion: v1\n    shards: [orders]\n",
  );
  return root;
}

const shardDirOf = (root: string) => join(root, "shards", "orders");
const manifestOf = (root: string) => readFileSync(join(root, ".sharding", "manifest.yaml"), "utf8");

/** The conductor bumps the frozen contract without changing any slice shape. */
function bumpVersionOnly(root: string, to: string): void {
  writeFileSync(join(root, "contract", "VERSION"), to);
}

/** The shard's declared surface diverges from the contract. */
function introduceDrift(root: string): void {
  const drifted = structuredClone(ORDER) as any;
  delete drifted.symbols.Order.shape.fields.id;
  writeFileSync(join(root, "shards", "orders", "surface", "Order.json"), JSON.stringify(drifted));
}

describe("locateShard", () => {
  it("derives the repo root and shard from a shard directory", () => {
    const root = scaffold();
    const loc = locateShard(shardDirOf(root));
    expect(loc?.shard).toBe("orders");
    expect(loc?.repoRoot).toBe(root);
    expect(loc?.shardDir).toBe(shardDirOf(root));
  });

  it("still resolves from a nested directory inside the shard", () => {
    const root = scaffold();
    const nested = join(shardDirOf(root), "src", "handlers");
    mkdirSync(nested, { recursive: true });
    expect(locateShard(nested)?.shard).toBe("orders");
  });

  it("returns null at the conductor root", () => {
    const root = scaffold();
    expect(locateShard(root)).toBeNull();
  });

  it("anchors to the outermost shards/ so a nested shards dir is not a repo boundary", () => {
    const root = scaffold();
    const nested = join(shardDirOf(root), "tools", "shards", "output");
    mkdirSync(nested, { recursive: true });
    const loc = locateShard(nested);
    expect(loc?.shard).toBe("orders");
    expect(loc?.repoRoot).toBe(root);
  });
});

describe("shard-local acknowledgment record", () => {
  it("reads null when the shard has never acknowledged", () => {
    const root = scaffold();
    expect(readAck(shardDirOf(root))).toBeNull();
  });

  it("round-trips a version through the record", () => {
    const root = scaffold();
    writeAck(shardDirOf(root), "v2");
    expect(readAck(shardDirOf(root))).toBe("v2");
  });

  it("writes the record inside the shard's own directory", () => {
    const root = scaffold();
    writeAck(shardDirOf(root), "v2");
    expect(readFileSync(join(shardDirOf(root), "surface", "ACKNOWLEDGED"), "utf8").trim()).toBe("v2");
  });

  it("treats a truncated record as never acknowledged rather than as version ''", () => {
    const root = scaffold();
    writeFileSync(join(shardDirOf(root), "surface", "ACKNOWLEDGED"), "  \n");
    expect(readAck(shardDirOf(root))).toBeNull();
    expect(checkShard(root, "orders").verifiedAgainst).toBe("v1");
  });

  it("creates the surface directory when the shard has none yet", () => {
    const root = scaffold();
    rmSync(join(shardDirOf(root), "surface"), { recursive: true });
    writeAck(shardDirOf(root), "v2");
    expect(readAck(shardDirOf(root))).toBe("v2");
  });
});

describe("checkShard: contract version staleness", () => {
  it("is not stale when the contract version matches", () => {
    const root = scaffold();
    const result = checkShard(root, "orders");
    expect(result.versionStale).toBe(false);
    expect(result.contractVersion).toBe("v1");
    expect(result.verifiedAgainst).toBe("v1");
  });

  it("falls back to the manifest contractVersion when the shard has never acknowledged", () => {
    const root = scaffold();
    expect(checkShard(root, "orders").verifiedAgainst).toBe("v1");
  });

  it("prefers the shard's own acknowledgment record over the manifest default", () => {
    const root = scaffold({ acknowledged: "v2" });
    bumpVersionOnly(root, "v2");
    const result = checkShard(root, "orders");
    expect(result.verifiedAgainst).toBe("v2");
    expect(result.versionStale).toBe(false);
  });

  it("reports stale when the contract is bumped with no shape change", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    const result = checkShard(root, "orders");
    expect(result.versionStale).toBe(true);
    expect(result.contractVersion).toBe("v2");
    expect(result.verifiedAgainst).toBe("v1");
  });

  it("keeps a stale shard structurally clean: staleness is not drift", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    const result = checkShard(root, "orders");
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("cli check: staleness does not fail the everyday check", () => {
  it("exits 0 when the only problem is a stale contract version", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    const { code, stdout } = run(["check", "orders"], root);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).versionStale).toBe(true);
  });

  it("still exits 1 when the shard has real drift", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    introduceDrift(root);
    const { code } = run(["check", "orders"], root);
    expect(code).toBe(1);
  });
});

describe("status: stale shards are reported separately from drift", () => {
  it("lists a stale shard without putting it in the drift blast radius", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    const report = status(root);
    expect(report.staleShards).toEqual(["orders"]);
    expect(report.blastRadius).toEqual([]);
  });
});

describe("checkPhase: the gate blocks on an unacknowledged contract bump", () => {
  it("fails when a participating shard is stale, even with everything else clean", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    const result = checkPhase(root, () => ({ ok: true, output: "ok" }));
    expect(result.passed).toBe(false);
    expect(result.versionsAcknowledged).toBe(false);
    expect(result.staleShards).toEqual(["orders"]);
    expect(result.shardsClean).toBe(true);
  });

  it("passes once the shard has acknowledged the new contract version", () => {
    const root = scaffold({ acknowledged: "v2" });
    bumpVersionOnly(root, "v2");
    const result = checkPhase(root, () => ({ ok: true, output: "ok" }));
    expect(result.passed).toBe(true);
    expect(result.versionsAcknowledged).toBe(true);
    expect(result.staleShards).toEqual([]);
  });
});

describe("cli ack: the shard records its own review, in its own sandbox", () => {
  it("records the current contract version when run from inside the shard", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    const { code, stdout } = run(["ack"], shardDirOf(root));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ shard: "orders", acknowledged: true, verifiedAgainst: "v2" });
    expect(readAck(shardDirOf(root))).toBe("v2");
  });

  it("leaves conductor state untouched: the manifest is not rewritten", () => {
    const root = scaffold();
    const before = manifestOf(root);
    bumpVersionOnly(root, "v2");
    run(["ack"], shardDirOf(root));
    expect(manifestOf(root)).toBe(before);
  });

  it("works from a nested directory inside the shard", () => {
    const root = scaffold();
    const nested = join(shardDirOf(root), "src");
    mkdirSync(nested, { recursive: true });
    bumpVersionOnly(root, "v2");
    expect(run(["ack"], nested).code).toBe(0);
    expect(readAck(shardDirOf(root))).toBe("v2");
  });

  it("refuses when run from the conductor root: only a shard may acknowledge itself", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    const { code, stdout } = run(["ack"], root);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).acknowledged).toBe(false);
    expect(JSON.parse(stdout).reason).toMatch(/shard/);
    expect(readAck(shardDirOf(root))).toBeNull();
  });

  it("clears the stale state so the phase gate passes", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    run(["ack"], shardDirOf(root));
    expect(checkShard(root, "orders").versionStale).toBe(false);
    expect(checkPhase(root, () => ({ ok: true, output: "ok" })).passed).toBe(true);
  });

  it("cannot launder drift: acknowledging a drifted shard still fails the gate", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    introduceDrift(root);
    expect(run(["ack"], shardDirOf(root)).code).toBe(0); // the shard may claim it looked...
    const result = checkPhase(root, () => ({ ok: true, output: "ok" }));
    expect(result.versionsAcknowledged).toBe(true);
    expect(result.shardsClean).toBe(false); // ...but the conductor still measures it
    expect(result.passed).toBe(false);
  });
});
