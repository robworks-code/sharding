import { describe, expect, it } from "vitest";
import { SurfaceValidationError, validateSurface } from "../../src/surface/validate";

const SRC = "surface/Order.json";

function surface(symbols: unknown) {
  return { slice: "Order", symbols };
}

describe("validateSurface", () => {
  it("accepts a canonical surface and returns it normalized", () => {
    const value = surface({
      Order: {
        name: "Order",
        kind: "type",
        shape: {
          kind: "object",
          fields: {
            id: { type: { kind: "primitive", name: "string" }, required: true },
            tags: { type: { kind: "array", items: { kind: "primitive", name: "string" } }, required: false },
            status: { type: { kind: "enum", values: ["new", "done"] }, required: true },
            parent: { type: { kind: "ref", name: "Order" }, required: false },
          },
        },
      },
    });
    expect(validateSurface(value, SRC)).toEqual(value);
  });

  it("defaults a symbol's name to its map key", () => {
    const result = validateSurface(
      surface({ Order: { kind: "type", shape: { kind: "object", fields: {} } } }),
      SRC,
    );
    expect(result.symbols.Order.name).toBe("Order");
  });

  describe("rejects", () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ["a non-object root", 42, /<root> must be a JSON object/],
      ["a free-form provides shape", { interface: "events", provides: {} }, /slice is missing/],
      ["a missing symbols map", { slice: "Order" }, /symbols is missing or not an object/],
      [
        "an unknown symbol kind",
        surface({ Order: { name: "Order", kind: "klass", shape: { kind: "object", fields: {} } } }),
        /symbols\.Order has an invalid symbol kind "klass"/,
      ],
      [
        "a name that disagrees with its key",
        surface({ Order: { name: "Invoice", kind: "type", shape: { kind: "object", fields: {} } } }),
        /declares name "Invoice" but is keyed as "Order"/,
      ],
      [
        "an unknown shape kind",
        surface({ Order: { name: "Order", kind: "type", shape: { kind: "tuple" } } }),
        /symbols\.Order\.shape has an invalid shape kind "tuple"/,
      ],
      [
        "an invalid primitive name",
        surface({ Order: { name: "Order", kind: "type", shape: { kind: "primitive", name: "int" } } }),
        /invalid name "int"/,
      ],
      [
        "an object shape with no fields map",
        surface({ Order: { name: "Order", kind: "type", shape: { kind: "object" } } }),
        /is an object shape but has no `fields` object/,
      ],
      [
        "a field missing `required`",
        surface({
          Order: {
            name: "Order",
            kind: "type",
            shape: { kind: "object", fields: { id: { type: { kind: "primitive", name: "string" } } } },
          },
        }),
        /symbols\.Order\.shape\.id must declare `required` as a boolean/,
      ],
      [
        "an enum whose values are not strings",
        surface({ Order: { name: "Order", kind: "type", shape: { kind: "enum", values: [1, 2] } } }),
        /`values` is not an array of strings/,
      ],
      [
        "a ref with no name",
        surface({ Order: { name: "Order", kind: "type", shape: { kind: "ref" } } }),
        /is a ref but has no non-empty `name`/,
      ],
      [
        // Distinct from the case above: an absent name trips the type check,
        // an empty one only trips the length check. Without both, half the
        // guard is unexercised and a mutation to it passes silently.
        "a ref whose name is the empty string",
        surface({ Order: { name: "Order", kind: "type", shape: { kind: "ref", name: "" } } }),
        /is a ref but has no non-empty `name`/,
      ],
    ];

    for (const [label, value, pattern] of cases) {
      it(label, () => {
        expect(() => validateSurface(value, SRC)).toThrow(pattern);
        expect(() => validateSurface(value, SRC)).toThrow(SurfaceValidationError);
      });
    }

    it("a nested field, reporting the full path to it", () => {
      const value = surface({
        Order: {
          name: "Order",
          kind: "type",
          shape: {
            kind: "object",
            fields: {
              lines: {
                required: true,
                type: {
                  kind: "array",
                  items: { kind: "object", fields: { sku: { type: { kind: "primitive", name: "str" }, required: true } } },
                },
              },
            },
          },
        },
      });
      expect(() => validateSurface(value, SRC)).toThrow(
        /symbols\.Order\.shape\.lines\.type\[\]\.sku\.type is a primitive with an invalid name "str"/,
      );
    });
  });

  it("rejects a surface read as a slice it does not declare", () => {
    // Stops one slice's surface from satisfying another slice's check.
    const value = surface({ Order: { name: "Order", kind: "type", shape: { kind: "object", fields: {} } } });
    expect(() => validateSurface(value, SRC, "Invoice")).toThrow(
      /slice declares "Order" but was read as slice "Invoice"/,
    );
    expect(() => validateSurface(value, SRC, "Order")).not.toThrow();
  });

  it("names the source file in every error", () => {
    expect(() => validateSurface({ slice: "Order" }, "contract/schemas/order.json")).toThrow(
      /^contract\/schemas\/order\.json: /,
    );
  });
});
