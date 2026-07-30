import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli";

/**
 * End-to-end coverage for a workspace whose shards do NOT all speak the same
 * format.
 *
 * The unit tests exercise each adapter against a synthetic temp directory. That
 * leaves the wiring between an adapter and the checker unmeasured, and the
 * wiring is where the interesting bugs live: which role a surface is read as,
 * which path that role resolves to, which slice it is diffed against. The
 * consume-side adapter bypass - every shard reading its consumed snapshots
 * through the identity layout regardless of its declared adapter - passed every
 * adapter unit test in the suite.
 *
 * So this workspace runs one shard per adapter through the real engine, and
 * asserts drift is caught in each shard's OWN format on both sides.
 */

const REPO = join(__dirname, "..", "..");

function freshMultistack(): string {
  const dst = mkdtempSync(join(tmpdir(), "multistack-"));
  cpSync(join(REPO, "examples", "multistack"), dst, { recursive: true });
  // The dts adapter resolves TypeScript from the shard's own dependency tree
  // and is never bundled, so a TypeScript shard carries its own node_modules.
  // In the repo the example inherits the root install; a copy out to /tmp has
  // to be given one, exactly as a real checkout would.
  symlinkSync(join(REPO, "node_modules"), join(dst, "shards", "checkout", "node_modules"), "dir");
  return dst;
}

function edit(path: string, mutate: (raw: string) => string): void {
  writeFileSync(path, mutate(readFileSync(path, "utf8")));
}

function findings(root: string, shard: string) {
  const { stdout } = run(["check", shard], root);
  return JSON.parse(stdout).findings;
}

describe("multi-adapter workspace e2e", () => {
  it("gates clean with five adapters in one phase", () => {
    const root = freshMultistack();
    const report = JSON.parse(run(["phase-check"], root).stdout);
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("plans the fan-out into waves the provider leads", () => {
    const root = freshMultistack();
    const plan = JSON.parse(run(["plan"], root).stdout);
    expect(plan.waves).toEqual([
      { index: 0, shards: ["catalog"] },
      { index: 1, shards: ["checkout", "pricing", "storefront", "telemetry"] },
    ]);
    expect(plan.cyclic).toEqual([]);
    expect(plan.unprovided).toEqual([]);
  });

  describe("catches drift in each shard's own provided format", () => {
    it("identity: a dropped field", () => {
      const root = freshMultistack();
      edit(join(root, "shards", "catalog", "surface", "Product.json"), (raw) => {
        const s = JSON.parse(raw);
        delete s.symbols.Product.shape.fields.sku;
        return JSON.stringify(s);
      });
      expect(findings(root, "catalog")).toContainEqual({
        slice: "Product",
        kind: "missing-field",
        location: "Product.sku",
        expected: "string",
      });
    });

    it("jsonschema: a retyped property", () => {
      const root = freshMultistack();
      edit(join(root, "shards", "pricing", "surface", "Price.schema.json"), (raw) =>
        raw.replace('"discount": { "type": "integer" }', '"discount": { "type": "string" }'),
      );
      // The symbol is `PriceQuote`, not `Price`: a jsonschema surface takes its
      // symbol name from the schema's `title`, and the slice it satisfies is a
      // separate thing. Naming them differently here is what keeps that wiring
      // measured rather than accidentally true.
      expect(findings(root, "pricing")).toContainEqual({
        slice: "Price",
        kind: "type-mismatch",
        location: "PriceQuote.discount",
        expected: "number",
        actual: "string",
      });
    });

    it("dts: an optional member made required", () => {
      const root = freshMultistack();
      edit(join(root, "shards", "checkout", "surface", "Cart.d.ts"), (raw) =>
        raw.replace("note?: string;", "note: string;"),
      );
      expect(findings(root, "checkout")).toContainEqual({
        slice: "Cart",
        kind: "required-mismatch",
        location: "Cart.note",
        expected: "false",
        actual: "true",
      });
    });

    it("openapi: a renamed operation", () => {
      const root = freshMultistack();
      edit(join(root, "shards", "storefront", "surface", "StorefrontAPI.openapi.yaml"), (raw) =>
        raw.replace("operationId: getCart", "operationId: fetchCart"),
      );
      const found = findings(root, "storefront");
      expect(found).toContainEqual({ slice: "StorefrontAPI", kind: "missing-symbol", location: "getCart" });
      expect(found).toContainEqual({ slice: "StorefrontAPI", kind: "unexpected-symbol", location: "fetchCart" });
    });

    it("protobuf: a field nobody declared", () => {
      const root = freshMultistack();
      edit(join(root, "shards", "telemetry", "surface", "PurchaseEvent.proto"), (raw) =>
        raw.replace("repeated string experiments = 4;", "repeated string experiments = 4;\n  string debug = 5;"),
      );
      expect(findings(root, "telemetry")).toContainEqual({
        slice: "PurchaseEvent",
        kind: "extra-field",
        location: "PurchaseEvent.debug",
        actual: "string",
      });
    });
  });

  describe("reads consumed snapshots through the shard's own adapter", () => {
    it("catches drift in a consumed snapshot written in the consumer's format", () => {
      const root = freshMultistack();
      edit(join(root, "shards", "telemetry", "surface", "consumed", "Product.proto"), (raw) =>
        raw.replace("string sku = 1;", "int32 sku = 1;"),
      );
      expect(findings(root, "telemetry")).toContainEqual({
        slice: "Product",
        kind: "type-mismatch",
        location: "Product.sku",
        expected: "string",
        actual: "number",
      });
    });

    it("does not fall back to the identity layout for a non-identity shard", () => {
      // The regression this file exists for: a stray canonical-JSON snapshot in
      // a jsonschema shard is not the file the checker reads, so corrupting it
      // must change nothing - and removing the real one must be reported at the
      // adapter's own path.
      const root = freshMultistack();
      const decoy = join(root, "shards", "pricing", "surface", "consumed", "Product.json");
      writeFileSync(decoy, JSON.stringify({ slice: "Product", symbols: {} }));
      expect(findings(root, "pricing")).toEqual([]);

      writeFileSync(join(root, "shards", "pricing", "surface", "consumed", "Product.schema.json"), "{ bad json");
      const found = findings(root, "pricing");
      expect(found).toHaveLength(1);
      expect(found[0].kind).toBe("invalid-surface");
      expect(found[0].location).toContain("Product.schema.json");
    });

    it("reports a missing consumed snapshot at the adapter's own path", () => {
      const root = freshMultistack();
      edit(join(root, ".sharding", "manifest.yaml"), (raw) =>
        raw.replace("consumes: [Product]\n  storefront", "consumes: [Product, Cart]\n  storefront"),
      );
      const found = findings(root, "checkout");
      expect(found).toHaveLength(1);
      expect(found[0].kind).toBe("missing-symbol");
      expect(found[0].location).toContain("surface/consumed/Cart.d.ts");
    });
  });

  it("validates adapter output before the differ sees it", () => {
    // An adapter can emit structurally invalid IR from a malformed input - here
    // an empty `$ref`, which yields a ref with no name. That must be rejected
    // by name at the file, not passed through to produce a confident
    // type-mismatch against a shape nobody declared.
    const root = freshMultistack();
    edit(join(root, "shards", "catalog", "surface", "Product.json"), (raw) =>
      raw.replace('"kind": "primitive", "name": "string"', '"kind": "primitive", "name": "str"'),
    );
    const found = findings(root, "catalog");
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("invalid-surface");
    expect(found[0].actual).toMatch(/is a primitive with an invalid name "str"/);

    // And an adapter that derives IR gets the same treatment: an empty `$ref`
    // is rejected at the file rather than becoming a null primitive.
    const other = freshMultistack();
    edit(join(other, "shards", "storefront", "surface", "consumed", "Product.openapi.json"), (raw) =>
      raw.replace('"$ref": "#/components/schemas/Money"', '"$ref": ""'),
    );
    const refFound = findings(other, "storefront");
    expect(refFound).toHaveLength(1);
    expect(refFound[0].kind).toBe("invalid-surface");
    expect(refFound[0].actual).toMatch(/does not name a symbol/);
  });

  it("reports an unrepresentable declaration as a finding, not a crash", () => {
    // A .d.ts the adapter cannot map structurally must land as drift on that
    // one shard: the slash commands parse this JSON, and one shard's bad file
    // must not take down the command for every other shard.
    const root = freshMultistack();
    edit(join(root, "shards", "checkout", "surface", "Cart.d.ts"), (raw) =>
      raw.replace("note?: string;", "note?: string;\n  [extra: string]: unknown;"),
    );
    const found = findings(root, "checkout");
    expect(found.map((f: any) => f.kind)).toEqual(["invalid-surface"]);

    // Every other shard still reports normally, and the gate still answers.
    const report = JSON.parse(run(["phase-check"], root).stdout);
    expect(report.passed).toBe(false);
    expect(report.findings.every((f: any) => f.slice === "Cart")).toBe(true);
  });
});
