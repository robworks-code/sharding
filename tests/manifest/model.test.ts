import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest, shardForDir } from "../../src/manifest/model";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shard-"));
  mkdirSync(join(root, ".sharding"), { recursive: true });
  writeFileSync(
    join(root, ".sharding", "manifest.yaml"),
    [
      "contractVersion: v1",
      "currentPhase: phase-1",
      "shards:",
      "  orders:",
      "    dir: shards/orders",
      "    adapter: identity",
      "    provides: [OrderAPI, Order]",
      "  gateway:",
      "    dir: shards/gateway",
      "    adapter: identity",
      "    consumes: [OrderAPI]",
      "",
    ].join("\n"),
  );
});

describe("loadManifest", () => {
  it("parses shards and defaults arrays", () => {
    const m = loadManifest(root);
    expect(m.currentPhase).toBe("phase-1");
    expect(m.shards.orders.provides).toEqual(["OrderAPI", "Order"]);
    expect(m.shards.orders.consumes).toEqual([]);
    expect(m.shards.gateway.consumes).toEqual(["OrderAPI"]);
  });

  it("maps a dir back to a shard name", () => {
    const m = loadManifest(root);
    expect(shardForDir(m, "shards/gateway")).toBe("gateway");
    expect(shardForDir(m, "shards/nope")).toBeNull();
  });
});
