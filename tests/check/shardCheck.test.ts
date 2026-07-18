import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkShard } from "../../src/check/shardCheck";

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "shard-"));
  mkdirSync(join(root, "contract", "schemas"), { recursive: true });
  mkdirSync(join(root, ".sharding"), { recursive: true });
  mkdirSync(join(root, "shards", "orders", "surface"), { recursive: true });
  writeFileSync(join(root, "contract", "VERSION"), "v1");
  const order = {
    slice: "Order",
    symbols: { Order: { name: "Order", kind: "type", shape: { kind: "object", fields: { id: { type: { kind: "primitive", name: "string" }, required: true } } } } },
  };
  writeFileSync(join(root, "contract", "schemas", "order.json"), JSON.stringify(order));
  writeFileSync(
    join(root, ".sharding", "manifest.yaml"),
    "contractVersion: v1\ncurrentPhase: phase-1\nshards:\n  orders:\n    dir: shards/orders\n    adapter: identity\n    provides: [Order]\n",
  );
  return { root, order } as any;
}

describe("checkShard", () => {
  it("is clean when the declared surface matches the contract", () => {
    const { root, order } = scaffold() as any;
    writeFileSync(join(root, "shards", "orders", "surface", "Order.json"), JSON.stringify(order));
    const result = checkShard(root, "orders");
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("reports a finding (does not throw) when the provided surface file is absent", () => {
    const { root } = scaffold() as any;
    // No surface/Order.json written - the shard hasn't been built yet.
    const result = checkShard(root, "orders");
    expect(result.clean).toBe(false);
    expect(result.findings).toContainEqual({ slice: "Order", kind: "missing-symbol", location: "Order (no provided surface)" });
  });

  it("reports drift when the declared surface diverges", () => {
    const { root, order } = scaffold() as any;
    const drifted = structuredClone(order);
    delete drifted.symbols.Order.shape.fields.id; // drop a required field
    writeFileSync(join(root, "shards", "orders", "surface", "Order.json"), JSON.stringify(drifted));
    const result = checkShard(root, "orders");
    expect(result.clean).toBe(false);
    expect(result.findings).toContainEqual({ slice: "Order", kind: "missing-field", location: "Order.id", expected: "string" });
  });
});
