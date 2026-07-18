import { describe, it, expect } from "vitest";
import { diffSurface } from "../../src/surface/diff";
import type { StructuralSurface } from "../../src/surface/types";

const objSym = (fields: Record<string, { t: any; required: boolean }>) => ({
  kind: "type" as const,
  name: "Order",
  shape: {
    kind: "object" as const,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { type: v.t, required: v.required }])),
  },
});
const str = { kind: "primitive" as const, name: "string" as const };
const num = { kind: "primitive" as const, name: "number" as const };

const surface = (symbols: Record<string, any>): StructuralSurface => ({ slice: "Order", symbols });

describe("diffSurface", () => {
  it("returns no findings when identical", () => {
    const s = surface({ Order: objSym({ id: { t: str, required: true } }) });
    expect(diffSurface(s, structuredClone(s))).toEqual([]);
  });

  it("flags a missing symbol", () => {
    const exp = surface({ Order: objSym({ id: { t: str, required: true } }) });
    const act = surface({});
    const f = diffSurface(exp, act);
    expect(f).toEqual([{ slice: "Order", kind: "missing-symbol", location: "Order" }]);
  });

  it("flags a missing required field", () => {
    const exp = surface({ Order: objSym({ id: { t: str, required: true }, total: { t: num, required: true } }) });
    const act = surface({ Order: objSym({ id: { t: str, required: true } }) });
    const f = diffSurface(exp, act);
    expect(f).toEqual([{ slice: "Order", kind: "missing-field", location: "Order.total", expected: "number" }]);
  });

  it("flags a type mismatch with expected/actual", () => {
    const exp = surface({ Order: objSym({ id: { t: str, required: true } }) });
    const act = surface({ Order: objSym({ id: { t: num, required: true } }) });
    const f = diffSurface(exp, act);
    expect(f).toEqual([
      { slice: "Order", kind: "type-mismatch", location: "Order.id", expected: "string", actual: "number" },
    ]);
  });

  it("flags a symbol kind mismatch", () => {
    const exp = surface({ Order: { ...objSym({}), kind: "type" } });
    const act = surface({ Order: { ...objSym({}), kind: "endpoint" } });
    const f = diffSurface(exp, act);
    expect(f).toEqual([
      { slice: "Order", kind: "kind-mismatch", location: "Order", expected: "type", actual: "endpoint" },
    ]);
  });
});
