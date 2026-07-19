import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli";
import { decidePreToolUse } from "../../hooks/logic.mjs";

function freshDemo(): string {
  const dst = mkdtempSync(join(tmpdir(), "demo-"));
  cpSync(join(__dirname, "..", "..", "examples", "demo"), dst, { recursive: true });
  return dst;
}

describe("sharding e2e demo", () => {
  it("SC1: a shard cannot read a sibling or write the contract", () => {
    const root = freshDemo();
    const gw = join(root, "shards", "gateway");
    expect(decidePreToolUse({ cwd: gw, repoRoot: root, shardDir: gw, toolName: "Read", targetPath: join(root, "shards/orders/impl.ts") }).deny).toBe(true);
    expect(decidePreToolUse({ cwd: gw, repoRoot: root, shardDir: gw, toolName: "Write", targetPath: join(root, "contract/schemas/order.json") }).deny).toBe(true);
  });

  it("SC2: a drifting shard fails its check (Stop hook would block)", () => {
    const root = freshDemo();
    const p = join(root, "shards", "orders", "surface", "Order.json");
    const drifted = JSON.parse(readFileSync(p, "utf8"));
    delete drifted.symbols.Order.shape.fields.total;
    writeFileSync(p, JSON.stringify(drifted));
    const { code, stdout } = run(["check", "orders"], root);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).findings).toContainEqual({ slice: "Order", kind: "missing-field", location: "Order.total", expected: "number" });
  });

  it("SC3: a contract change surfaces its exact blast radius", () => {
    const root = freshDemo();
    // Conductor adds a required field to Order and bumps the version.
    const cp = join(root, "contract", "schemas", "order.json");
    const order = JSON.parse(readFileSync(cp, "utf8"));
    order.symbols.Order.shape.fields.currency = { type: { kind: "primitive", name: "string" }, required: true };
    writeFileSync(cp, JSON.stringify(order));
    writeFileSync(join(root, "contract", "VERSION"), "v2");
    const { stdout } = run(["status"], root);
    const report = JSON.parse(stdout);
    expect(report.contractVersion).toBe("v2");
    expect(report.blastRadius.sort()).toEqual(["gateway", "orders"]); // both were built against v1
  });

  it("SC3b: a version bump with no shape change is caught, and only an explicit ack clears it", () => {
    const root = freshDemo();
    // A semantically breaking but structurally invisible change: the conductor
    // freezes a new version without altering any declared shape.
    writeFileSync(join(root, "contract", "VERSION"), "v2");

    // Everyday check still passes - staleness is not drift - but says so.
    const check = run(["check", "orders"], root);
    expect(check.code).toBe(0);
    expect(JSON.parse(check.stdout).versionStale).toBe(true);

    // The gate refuses: no shard has been checked against v2.
    const gated = run(["phase-check"], root);
    expect(gated.code).toBe(1);
    const gatedReport = JSON.parse(gated.stdout);
    expect(gatedReport.passed).toBe(false);
    expect(gatedReport.shardsClean).toBe(true); // nothing drifted
    expect(gatedReport.staleShards.sort()).toEqual(["gateway", "orders"]);

    // A clean diff alone must not re-bless the shards: acking is deliberate.
    run(["ack", "orders"], root);
    expect(JSON.parse(run(["phase-check"], root).stdout).staleShards).toEqual(["gateway"]);

    run(["ack", "gateway"], root);
    expect(JSON.parse(run(["phase-check"], root).stdout).passed).toBe(true);
  });

  it("SC4: phase-check passes only when all shards conform", () => {
    const root = freshDemo();
    const clean = run(["phase-check"], root);
    expect(JSON.parse(clean.stdout).passed).toBe(true);

    // Break one shard, re-gate: must fail.
    const p = join(root, "shards", "orders", "surface", "OrderAPI.json");
    const api = JSON.parse(readFileSync(p, "utf8"));
    delete api.symbols.placeOrder;
    writeFileSync(p, JSON.stringify(api));
    const broken = run(["phase-check"], root);
    expect(JSON.parse(broken.stdout).passed).toBe(false);
  });
});
