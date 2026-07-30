import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapterNames, extractSurface, getAdapter, surfaceExists } from "../../src/adapters/index";

describe("identity adapter", () => {
  it("reads canonical surface JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "shard-"));
    mkdirSync(join(dir, "surface"), { recursive: true });
    const surface = { slice: "Order", symbols: { Order: { name: "Order", kind: "type", shape: { kind: "object", fields: {} } } } };
    writeFileSync(join(dir, "surface", "Order.json"), JSON.stringify(surface));
    expect(extractSurface(getAdapter("identity"), dir, "Order", "provided")).toEqual(surface);
  });

  it("reports existence of the surface file", () => {
    const dir = mkdtempSync(join(tmpdir(), "shard-"));
    mkdirSync(join(dir, "surface"), { recursive: true });
    const adapter = getAdapter("identity");
    expect(surfaceExists(adapter, dir, "Order", "provided")).toBe(false);
    writeFileSync(join(dir, "surface", "Order.json"), JSON.stringify({ slice: "Order", symbols: {} }));
    expect(surfaceExists(adapter, dir, "Order", "provided")).toBe(true);
  });

  it("reads a consumed snapshot from surface/consumed/", () => {
    const dir = mkdtempSync(join(tmpdir(), "shard-"));
    mkdirSync(join(dir, "surface", "consumed"), { recursive: true });
    const adapter = getAdapter("identity");
    // The provided file must not satisfy the consumed role - they are separate
    // claims and the checker reads them from separate places.
    writeFileSync(join(dir, "surface", "Order.json"), JSON.stringify({ slice: "Order", symbols: {} }));
    expect(surfaceExists(adapter, dir, "Order", "consumed")).toBe(false);

    writeFileSync(join(dir, "surface", "consumed", "Order.json"), JSON.stringify({ slice: "Order", symbols: {} }));
    expect(surfaceExists(adapter, dir, "Order", "consumed")).toBe(true);
    expect(extractSurface(adapter, dir, "Order", "consumed").slice).toBe("Order");
  });

  it("rejects unknown adapters, naming the ones that exist", () => {
    // Derived from the registry rather than hardcoded: the useful assertion is
    // "the message lists what IS available", which registering a new adapter
    // should extend, not break.
    expect(() => getAdapter("nope")).toThrow(
      `unknown adapter: nope (available: ${adapterNames().join(", ")})`,
    );
    expect(adapterNames()).toContain("identity");
  });
});
