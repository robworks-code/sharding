import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractSurface, getAdapter } from "../../src/adapters/index";

const adapter = getAdapter("dts");
const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * The shard dir is created under this repo so `require("typescript")` resolves
 * the way it would inside a real TypeScript shard - from the shard's own tree.
 */
function shardWith(dts: string, role: "provided" | "consumed" = "provided"): string {
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".tmp-dts-"));
  created.push(dir);
  const target = role === "consumed" ? join(dir, "surface", "consumed") : join(dir, "surface");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "Order.d.ts"), dts);
  return dir;
}

function extract(dts: string, role: "provided" | "consumed" = "provided") {
  return extractSurface(adapter, shardWith(dts, role), "Order", role);
}

describe("dts adapter", () => {
  it("maps an exported interface to an object symbol", () => {
    const surface = extract(`
      export interface Order {
        id: string;
        total?: number;
        tags: string[];
        status: "pending" | "shipped";
      }
    `);
    expect(surface.slice).toBe("Order");
    expect(surface.symbols.Order.kind).toBe("type");
    const fields = (surface.symbols.Order.shape as any).fields;
    expect(fields.id).toEqual({ type: { kind: "primitive", name: "string" }, required: true });
    // `?:` is optionality, which the surface models as `required: false`.
    expect(fields.total).toEqual({ type: { kind: "primitive", name: "number" }, required: false });
    expect(fields.tags).toEqual({
      type: { kind: "array", items: { kind: "primitive", name: "string" } },
      required: true,
    });
    expect(fields.status).toEqual({
      type: { kind: "enum", values: ["pending", "shipped"] },
      required: true,
    });
  });

  it("ignores declarations the consumer cannot reach", () => {
    const surface = extract(`
      interface Internal { secret: string; }
      export interface Order { id: string; }
    `);
    expect(Object.keys(surface.symbols)).toEqual(["Order"]);
  });

  it("maps an exported function to params and returns", () => {
    const surface = extract(`
      export declare function placeOrder(order: Order, dryRun?: boolean): string;
    `);
    expect(surface.symbols.placeOrder.kind).toBe("function");
    const fields = (surface.symbols.placeOrder.shape as any).fields;
    expect(fields.params.type.fields.order).toEqual({ type: { kind: "ref", name: "Order" }, required: true });
    expect(fields.params.type.fields.dryRun).toEqual({
      type: { kind: "primitive", name: "boolean" },
      required: false,
    });
    expect(fields.returns).toEqual({ type: { kind: "primitive", name: "string" }, required: true });
  });

  it("treats `T | undefined` as optionality, not a shape", () => {
    const surface = extract(`export type Maybe = string | undefined;`);
    expect(surface.symbols.Maybe.shape).toEqual({ kind: "primitive", name: "string" });
  });

  it("maps Array<T> and a named reference", () => {
    const surface = extract(`export type Lines = Array<Order>;`);
    expect(surface.symbols.Lines.shape).toEqual({
      kind: "array",
      items: { kind: "ref", name: "Order" },
    });
  });

  it("reads a consumed snapshot from surface/consumed/", () => {
    const surface = extract(`export interface Order { id: string; }`, "consumed");
    expect((surface.symbols.Order.shape as any).fields.id.required).toBe(true);
  });

  it("fails loudly on a type it cannot represent, rather than inventing one", () => {
    // Degrading to a bare `null` primitive here would produce confident,
    // precise drift findings about a shape nobody declared.
    expect(() => extract(`export type Weird = string & number;`)).toThrow(
      /cannot represent structurally \(IntersectionType\)/,
    );
  });

  it("names the file and the path within it when it fails", () => {
    expect(() => extract(`export interface Order { when: Date & string; }`)).toThrow(
      /Order\.d\.ts: Order\.when uses a TypeScript type/,
    );
  });
});
