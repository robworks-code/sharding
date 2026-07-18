import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAdapter } from "../../src/adapters/index";

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
    const surface = getAdapter("jsonschema").extract(dir, "Order");
    expect(surface.slice).toBe("Order");
    const shape = surface.symbols.Order.shape as any;
    expect(shape.fields.id).toEqual({ type: { kind: "primitive", name: "string" }, required: true });
    expect(shape.fields.total).toEqual({ type: { kind: "primitive", name: "number" }, required: false });
  });
});
