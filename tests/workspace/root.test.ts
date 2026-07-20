import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli";
import { resolveRoot } from "../../src/workspace/root";

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "shard-root-"));
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
  writeFileSync(join(root, "contract", "phases.yaml"), "phases:\n  - id: phase-1\n    shards: [orders]\n");
  return root;
}

describe("resolveRoot", () => {
  it("returns the workspace root unchanged when already there", () => {
    const root = scaffold();
    expect(resolveRoot(root)).toBe(root);
  });

  it("walks up to the workspace root from a nested conductor directory", () => {
    const root = scaffold();
    expect(resolveRoot(join(root, "contract", "schemas"))).toBe(root);
  });

  it("derives the root from the shard boundary when inside a shard", () => {
    const root = scaffold();
    expect(resolveRoot(join(root, "shards", "orders", "surface"))).toBe(root);
  });

  it("anchors to the outermost shards/ so a nested workspace cannot redefine the root", () => {
    const root = scaffold();
    // A shard that happens to contain its own shards/ subtree AND its own
    // .sharding dir must not be treated as a workspace boundary - the outer
    // conductor still owns the graph this shard is measured against.
    const inner = join(root, "shards", "orders", "vendor", "shards", "inner");
    mkdirSync(join(inner, "x"), { recursive: true });
    mkdirSync(join(root, "shards", "orders", ".sharding"), { recursive: true });
    writeFileSync(join(root, "shards", "orders", ".sharding", "manifest.yaml"), "shards: {}\n");
    expect(resolveRoot(join(inner, "x"))).toBe(root);
    expect(resolveRoot(join(root, "shards", "orders", "surface"))).toBe(root);
  });

  it("falls back to the given directory when there is no workspace above it", () => {
    const orphan = mkdtempSync(join(tmpdir(), "shard-orphan-"));
    expect(resolveRoot(orphan)).toBe(orphan);
  });
});

describe("cli root resolution", () => {
  it("check runs from inside the shard it names", () => {
    const root = scaffold();
    const { code, stdout } = run(["check", "orders"], join(root, "shards", "orders"));
    expect(code).toBe(0);
    expect(JSON.parse(stdout).clean).toBe(true);
  });

  it("check with no argument defaults to the shard the session is inside", () => {
    const root = scaffold();
    const { code, stdout } = run(["check"], join(root, "shards", "orders", "surface"));
    expect(code).toBe(0);
    expect(JSON.parse(stdout).shard).toBe("orders");
  });

  it("an explicit shard name wins over the shard the session is inside", () => {
    const root = scaffold();
    mkdirSync(join(root, "shards", "gateway"), { recursive: true });
    writeFileSync(
      join(root, ".sharding", "manifest.yaml"),
      "contractVersion: v1\ncurrentPhase: phase-1\nshards:\n  orders:\n    dir: shards/orders\n    adapter: identity\n    provides: [Order]\n  gateway:\n    dir: shards/gateway\n    adapter: identity\n    consumes: [Order]\n",
    );
    const { stdout } = run(["check", "gateway"], join(root, "shards", "orders"));
    expect(JSON.parse(stdout).shard).toBe("gateway");
  });

  it("check with no argument outside a shard explains itself instead of crashing", () => {
    const root = scaffold();
    const { code, stdout } = run(["check"], root);
    expect(code).toBe(1);
    const out = JSON.parse(stdout);
    expect(out.checked).toBe(false);
    expect(out.reason).toMatch(/shard/);
  });

  it("status runs from inside a shard", () => {
    const root = scaffold();
    const { stdout } = run(["status"], join(root, "shards", "orders"));
    expect(JSON.parse(stdout).contractVersion).toBe("v1");
  });

  it("phase-check runs from a nested conductor directory", () => {
    const root = scaffold();
    const { stdout } = run(["phase-check"], join(root, "contract", "schemas"));
    expect(JSON.parse(stdout).phase).toBe("phase-1");
  });

  it("still reports a missing manifest against the directory it was given", () => {
    const orphan = mkdtempSync(join(tmpdir(), "shard-orphan-"));
    expect(() => run(["status"], orphan)).toThrow(new RegExp(orphan));
  });
});
