import { describe, it, expect } from "vitest";
import type { StructuralSurface } from "../../src/surface/types";
import { isObjectShape } from "../../src/surface/types";

describe("surface types", () => {
  it("narrows object shapes", () => {
    const surface: StructuralSurface = {
      slice: "Order",
      symbols: {
        Order: {
          name: "Order",
          kind: "type",
          shape: { kind: "object", fields: { id: { type: { kind: "primitive", name: "string" }, required: true } } },
        },
      },
    };
    const shape = surface.symbols.Order.shape;
    expect(isObjectShape(shape)).toBe(true);
    if (isObjectShape(shape)) expect(shape.fields.id.required).toBe(true);
  });
});
