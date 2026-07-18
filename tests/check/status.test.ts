import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { status } from "../../src/check/status";

function scaffold(idType: "string" | "number"): string {
  const root = mkdtempSync(join(tmpdir(), "shard-"));
  mkdirSync(join(root, "contract", "schemas"), { recursive: true });
  mkdirSync(join(root, ".sharding"), { recursive: true });
  mkdirSync(join(root, "shards", "orders", "surface"), { recursive: true });
  writeFileSync(join(root, "contract", "VERSION"), "v1");
  const order = (t: string) => ({
    slice: "Order",
    symbols: { Order: { name: "Order", kind: "type", shape: { kind: "object", fields: { id: { type: { kind: "primitive", name: t }, required: true } } } } },
  });
  writeFileSync(join(root, "contract", "schemas", "order.json"), JSON.stringify(order(idType)));
  writeFileSync(join(root, "shards", "orders", "surface", "Order.json"), JSON.stringify(order("string")));
  writeFileSync(
    join(root, ".sharding", "manifest.yaml"),
    "contractVersion: v1\ncurrentPhase: phase-1\nshards:\n  orders:\n    dir: shards/orders\n    adapter: identity\n    provides: [Order]\n",
  );
  return root;
}

describe("status", () => {
  it("empty blast radius when everything conforms", () => {
    const report = status(scaffold("string"));
    expect(report.blastRadius).toEqual([]);
    expect(report.currentPhase).toBe("phase-1");
  });
  it("names the drifting shard in the blast radius", () => {
    const report = status(scaffold("number")); // contract now expects number, shard declares string
    expect(report.blastRadius).toEqual(["orders"]);
  });
});
