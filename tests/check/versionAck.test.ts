import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { checkShard } from "../../src/check/shardCheck";
import { checkPhase } from "../../src/check/phaseCheck";
import { status } from "../../src/check/status";
import { loadManifest } from "../../src/manifest/model";
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
function scaffold(opts: { verifiedAgainst?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "vack-"));
  mkdirSync(join(root, "contract", "schemas"), { recursive: true });
  mkdirSync(join(root, ".sharding"), { recursive: true });
  mkdirSync(join(root, "shards", "orders", "surface"), { recursive: true });
  writeFileSync(join(root, "contract", "VERSION"), "v1");
  writeFileSync(join(root, "contract", "schemas", "order.json"), JSON.stringify(ORDER));
  writeFileSync(join(root, "shards", "orders", "surface", "Order.json"), JSON.stringify(ORDER));
  const verified = opts.verifiedAgainst ? `\n    verifiedAgainst: ${opts.verifiedAgainst}` : "";
  writeFileSync(
    join(root, ".sharding", "manifest.yaml"),
    `contractVersion: v1\ncurrentPhase: phase-1\nshards:\n  orders:\n    dir: shards/orders\n    adapter: identity\n    provides: [Order]${verified}\n`,
  );
  writeFileSync(
    join(root, "contract", "phases.yaml"),
    "phases:\n  - id: phase-1\n    contractVersion: v1\n    shards: [orders]\n",
  );
  return root;
}

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

describe("manifest: verifiedAgainst", () => {
  it("parses a per-shard verifiedAgainst version", () => {
    const root = scaffold({ verifiedAgainst: "v3" });
    expect(loadManifest(root).shards.orders.verifiedAgainst).toBe("v3");
  });

  it("leaves verifiedAgainst undefined when the shard has never been acknowledged", () => {
    const root = scaffold();
    expect(loadManifest(root).shards.orders.verifiedAgainst).toBeUndefined();
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

  it("falls back to the manifest contractVersion when the shard was never acknowledged", () => {
    const root = scaffold();
    expect(checkShard(root, "orders").verifiedAgainst).toBe("v1");
  });

  it("prefers an explicit per-shard verifiedAgainst over the manifest default", () => {
    const root = scaffold({ verifiedAgainst: "v2" });
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
    const root = scaffold({ verifiedAgainst: "v2" });
    bumpVersionOnly(root, "v2");
    const result = checkPhase(root, () => ({ ok: true, output: "ok" }));
    expect(result.passed).toBe(true);
    expect(result.versionsAcknowledged).toBe(true);
    expect(result.staleShards).toEqual([]);
  });
});

describe("cli ack: acknowledgment is explicit", () => {
  it("stamps the shard with the current contract version", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    const { code } = run(["ack", "orders"], root);
    expect(code).toBe(0);
    const manifest = parse(readFileSync(join(root, ".sharding", "manifest.yaml"), "utf8"));
    expect(manifest.shards.orders.verifiedAgainst).toBe("v2");
  });

  it("clears the stale state so the phase gate passes", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    run(["ack", "orders"], root);
    expect(checkShard(root, "orders").versionStale).toBe(false);
    expect(checkPhase(root, () => ({ ok: true, output: "ok" })).passed).toBe(true);
  });

  it("refuses to acknowledge a shard that has drifted", () => {
    const root = scaffold();
    bumpVersionOnly(root, "v2");
    introduceDrift(root);
    const { code, stdout } = run(["ack", "orders"], root);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).acknowledged).toBe(false);
    const manifest = parse(readFileSync(join(root, ".sharding", "manifest.yaml"), "utf8"));
    expect(manifest.shards.orders?.verifiedAgainst).toBeUndefined();
  });

  it("preserves other shard entries when rewriting the manifest", () => {
    const root = scaffold();
    writeFileSync(
      join(root, ".sharding", "manifest.yaml"),
      "contractVersion: v1\ncurrentPhase: phase-1\nshards:\n" +
        "  orders:\n    dir: shards/orders\n    adapter: identity\n    provides: [Order]\n" +
        "  gateway:\n    dir: shards/gateway\n    adapter: identity\n    consumes: [Order]\n",
    );
    bumpVersionOnly(root, "v2");
    const { code } = run(["ack", "orders"], root);
    expect(code).toBe(0);
    const m = loadManifest(root);
    // the ack landed...
    expect(m.shards.orders.verifiedAgainst).toBe("v2");
    // ...without collateral damage to the rest of the graph
    expect(m.shards.gateway.dir).toBe("shards/gateway");
    expect(m.shards.gateway.consumes).toEqual(["Order"]);
    expect(m.shards.gateway.verifiedAgainst).toBeUndefined();
    expect(m.currentPhase).toBe("phase-1");
  });
});
