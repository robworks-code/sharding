import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSurface, getAdapter, surfaceExists } from "../../src/adapters/index";

describe("jsonschema adapter", () => {
  it("normalizes a JSON Schema object to a structural surface", () => {
    const dir = mkdtempSync(join(tmpdir(), "shard-"));
    mkdirSync(join(dir, "surface"), { recursive: true });
    writeFileSync(
      join(dir, "surface", "Order.schema.json"),
      JSON.stringify({
        title: "Order",
        type: "object",
        properties: { id: { type: "string" }, total: { type: "number" } },
        required: ["id"],
      }),
    );
    const surface = extractSurface(getAdapter("jsonschema"), dir, "Order", "provided");
    expect(surface.slice).toBe("Order");
    const shape = surface.symbols.Order.shape as any;
    expect(shape.fields.id).toEqual({ type: { kind: "primitive", name: "string" }, required: true });
    expect(shape.fields.total).toEqual({ type: { kind: "primitive", name: "number" }, required: false });
  });

  it.each([["" as unknown], ["#/"], [null]])("rejects a $ref that names nothing: %j", (ref) => {
    // `$ref: ""` used to fail a truthiness test, fall through to the default
    // branch and come out a null primitive - so the differ reported confident
    // type drift against a shape the schema never declared.
    const dir = mkdtempSync(join(tmpdir(), "shard-"));
    mkdirSync(join(dir, "surface"), { recursive: true });
    writeFileSync(
      join(dir, "surface", "Order.schema.json"),
      JSON.stringify({ title: "Order", type: "object", properties: { line: { $ref: ref } } }),
    );
    expect(() => extractSurface(getAdapter("jsonschema"), dir, "Order", "provided")).toThrow(
      /does not name a symbol/,
    );
  });

  it("reads a consumed snapshot as a schema too, not as canonical JSON", () => {
    // The consume side used to hardcode `surface/consumed/<slice>.json`, so a
    // jsonschema shard had to hand-write canonical IR for what it consumed
    // while writing schemas for what it provided. Both roles are schemas now.
    const dir = mkdtempSync(join(tmpdir(), "shard-"));
    mkdirSync(join(dir, "surface", "consumed"), { recursive: true });
    const adapter = getAdapter("jsonschema");
    writeFileSync(
      join(dir, "surface", "consumed", "Order.schema.json"),
      JSON.stringify({ title: "Order", type: "object", properties: { id: { type: "string" } }, required: ["id"] }),
    );

    expect(surfaceExists(adapter, dir, "Order", "consumed")).toBe(true);
    const surface = extractSurface(adapter, dir, "Order", "consumed");
    expect((surface.symbols.Order.shape as any).fields.id).toEqual({
      type: { kind: "primitive", name: "string" },
      required: true,
    });
  });
});
