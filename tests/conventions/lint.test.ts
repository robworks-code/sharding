import { describe, it, expect } from "vitest";
import { lintConventions } from "../../src/conventions/lint";
import type { StructuralSurface } from "../../src/surface/types";

const surface: StructuralSurface = {
  slice: "Order",
  symbols: {
    order: { // lowercase symbol - violates ^[A-Z]
      name: "order",
      kind: "type",
      shape: { kind: "object", fields: { Total: { type: { kind: "primitive", name: "number" }, required: true } } },
    },
  },
};

describe("lintConventions", () => {
  it("flags symbol and field names that break the patterns", () => {
    const findings = lintConventions(surface, { symbolNamePattern: "^[A-Z]", fieldNamePattern: "^[a-z]" });
    expect(findings).toEqual([
      { slice: "Order", kind: "type-mismatch", location: "order", expected: "^[A-Z]", actual: "order" },
      { slice: "Order", kind: "type-mismatch", location: "order.Total", expected: "^[a-z]", actual: "Total" },
    ]);
  });

  it("returns nothing with no rules", () => {
    expect(lintConventions(surface, {})).toEqual([]);
  });
});
