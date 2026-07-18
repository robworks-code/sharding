import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPhase } from "../../src/check/phaseCheck";

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "shard-"));
  mkdirSync(join(root, "contract", "schemas"), { recursive: true });
  mkdirSync(join(root, ".sharding"), { recursive: true });
  mkdirSync(join(root, "shards", "orders", "surface"), { recursive: true });
  writeFileSync(join(root, "contract", "VERSION"), "v1");
  const order = {
    slice: "Order",
    symbols: { Order: { name: "Order", kind: "type", shape: { kind: "object", fields: {} } } },
  };
  writeFileSync(join(root, "contract", "schemas", "order.json"), JSON.stringify(order));
  writeFileSync(join(root, "shards", "orders", "surface", "Order.json"), JSON.stringify(order));
  writeFileSync(
    join(root, ".sharding", "manifest.yaml"),
    "contractVersion: v1\ncurrentPhase: phase-1\nshards:\n  orders:\n    dir: shards/orders\n    adapter: identity\n    provides: [Order]\n",
  );
  writeFileSync(
    join(root, "contract", "phases.yaml"),
    "phases:\n  - id: phase-1\n    contractVersion: v1\n    shards: [orders]\n    acceptance: run-integration\n",
  );
  return root;
}

describe("checkPhase", () => {
  it("passes when shards are clean and acceptance passes", () => {
    const root = scaffold();
    const result = checkPhase(root, () => ({ ok: true, output: "ok" }));
    expect(result.passed).toBe(true);
    expect(result.shardsClean).toBe(true);
    expect(result.acceptancePassed).toBe(true);
  });

  it("fails when acceptance fails even if shards are clean", () => {
    const root = scaffold();
    const result = checkPhase(root, () => ({ ok: false, output: "boom" }));
    expect(result.passed).toBe(false);
    expect(result.acceptancePassed).toBe(false);
    expect(result.acceptanceOutput).toBe("boom");
  });
});
