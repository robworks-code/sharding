import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract } from "../../src/contract/model";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shard-"));
  mkdirSync(join(root, "contract", "schemas"), { recursive: true });
  writeFileSync(join(root, "contract", "VERSION"), "v1\n");
  writeFileSync(
    join(root, "contract", "schemas", "order.json"),
    JSON.stringify({
      slice: "Order",
      symbols: { Order: { name: "Order", kind: "type", shape: { kind: "object", fields: {} } } },
    }),
  );
});

describe("loadContract", () => {
  it("loads version and slices keyed by slice name", () => {
    const c = loadContract(root);
    expect(c.version).toBe("v1");
    expect(Object.keys(c.slices)).toEqual(["Order"]);
  });

  it("throws when contract dir missing", () => {
    expect(() => loadContract(join(root, "nope"))).toThrow(/no contract/);
  });

  it("rejects a slice file that lacks a string slice field", () => {
    // A free-form interface shape with no canonical `slice` key.
    writeFileSync(
      join(root, "contract", "schemas", "bad.json"),
      JSON.stringify({ interface: "events", provides: {} }),
    );
    // The error must name the offending file - the reader is hand-writing JSON.
    expect(() => loadContract(root)).toThrow(/bad\.json: slice is missing or not a non-empty string/);
  });

  it("rejects a slice file that lacks a symbols object", () => {
    writeFileSync(
      join(root, "contract", "schemas", "nosym.json"),
      JSON.stringify({ slice: "Widget" }),
    );
    expect(() => loadContract(root)).toThrow(/nosym\.json: symbols is missing or not an object/);
  });

  it("rejects a duplicate slice declaration", () => {
    writeFileSync(
      join(root, "contract", "schemas", "dupe.json"),
      JSON.stringify({ slice: "Order", symbols: {} }),
    );
    expect(() => loadContract(root)).toThrow(/declared twice/);
  });
});
