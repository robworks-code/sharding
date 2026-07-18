import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli";

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "shard-"));
  mkdirSync(join(root, "contract", "schemas"), { recursive: true });
  mkdirSync(join(root, ".sharding"), { recursive: true });
  mkdirSync(join(root, "shards", "orders", "surface"), { recursive: true });
  writeFileSync(join(root, "contract", "VERSION"), "v1");
  const order = { slice: "Order", symbols: { Order: { name: "Order", kind: "type", shape: { kind: "object", fields: {} } } } };
  writeFileSync(join(root, "contract", "schemas", "order.json"), JSON.stringify(order));
  writeFileSync(join(root, "shards", "orders", "surface", "Order.json"), JSON.stringify(order));
  writeFileSync(
    join(root, ".sharding", "manifest.yaml"),
    "contractVersion: v1\ncurrentPhase: phase-1\nshards:\n  orders:\n    dir: shards/orders\n    adapter: identity\n    provides: [Order]\n",
  );
  return root;
}

describe("cli.run", () => {
  it("check returns code 0 and clean JSON for a conforming shard", () => {
    const { code, stdout } = run(["check", "orders"], scaffold());
    expect(code).toBe(0);
    expect(JSON.parse(stdout).clean).toBe(true);
  });

  it("sandbox-check denies a sibling read with code 1", () => {
    const root = scaffold();
    const { code, stdout } = run(
      ["sandbox-check", "--mode", "read", "--shard-dir", join(root, "shards/gateway"),
       "--contract-dir", join(root, "contract"), "--target", join(root, "shards/orders/x.ts")],
      root,
    );
    expect(code).toBe(1);
    expect(JSON.parse(stdout).allowed).toBe(false);
  });

  it("orient reports the shard role for a shard dir", () => {
    const root = scaffold();
    const { stdout } = run(["orient", "--dir", "shards/orders"], root);
    expect(JSON.parse(stdout)).toMatchObject({ role: "shard", shard: "orders" });
  });
});
