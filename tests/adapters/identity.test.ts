import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAdapter } from "../../src/adapters/index";

describe("identity adapter", () => {
  it("reads canonical surface JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "shard-"));
    mkdirSync(join(dir, "surface"), { recursive: true });
    const surface = { slice: "Order", symbols: { Order: { name: "Order", kind: "type", shape: { kind: "object", fields: {} } } } };
    writeFileSync(join(dir, "surface", "Order.json"), JSON.stringify(surface));
    expect(getAdapter("identity").extract(dir, "Order")).toEqual(surface);
  });

  it("rejects unknown adapters", () => {
    expect(() => getAdapter("nope")).toThrow(/unknown adapter/);
  });
});
