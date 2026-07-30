import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSurface, getAdapter } from "../../src/adapters/index";

const adapter = getAdapter("protobuf");

function extract(proto: string) {
  const dir = mkdtempSync(join(tmpdir(), "shard-proto-"));
  mkdirSync(join(dir, "surface"), { recursive: true });
  writeFileSync(join(dir, "surface", "Order.proto"), proto);
  return extractSurface(adapter, dir, "Order", "provided");
}

describe("protobuf adapter", () => {
  it("maps a message to an object symbol", () => {
    const surface = extract(`
      syntax = "proto3";
      package shop;

      message Order {
        string id = 1;
        int64 total_cents = 2;
        bool paid = 3;
        repeated string tags = 4;
        Customer customer = 5;
      }
    `);
    const fields = (surface.symbols.Order.shape as any).fields;
    expect(fields.id.type).toEqual({ kind: "primitive", name: "string" });
    expect(fields.total_cents.type).toEqual({ kind: "primitive", name: "number" });
    expect(fields.paid.type).toEqual({ kind: "primitive", name: "boolean" });
    expect(fields.tags.type).toEqual({ kind: "array", items: { kind: "primitive", name: "string" } });
    expect(fields.customer.type).toEqual({ kind: "ref", name: "Customer" });
  });

  it("marks every proto3 field optional", () => {
    // proto3 has no required fields. Claiming otherwise would manufacture
    // required-mismatch findings against another adapter's view of the slice.
    const surface = extract(`message Order { string id = 1; }`);
    expect((surface.symbols.Order.shape as any).fields.id.required).toBe(false);
  });

  it("ignores comments", () => {
    const surface = extract(`
      // message Ghost { string nope = 1; }
      /* message AlsoGhost { string nope = 1; } */
      message Order { string id = 1; }
    `);
    expect(Object.keys(surface.symbols)).toEqual(["Order"]);
  });

  it("maps an enum to enum values", () => {
    const surface = extract(`
      enum Status {
        STATUS_UNKNOWN = 0;
        STATUS_PAID = 1;
      }
    `);
    expect(surface.symbols.Status.shape).toEqual({
      kind: "enum",
      values: ["STATUS_UNKNOWN", "STATUS_PAID"],
    });
  });

  it("maps a map field to an array of its value type", () => {
    const surface = extract(`message Order { map<string, Line> lines = 1; }`);
    expect((surface.symbols.Order.shape as any).fields.lines.type).toEqual({
      kind: "array",
      items: { kind: "ref", name: "Line" },
    });
  });

  it("maps each rpc to an endpoint keyed by service.method", () => {
    const surface = extract(`
      service OrderService {
        rpc PlaceOrder (PlaceOrderRequest) returns (Order);
      }
    `);
    const sym = surface.symbols["OrderService.PlaceOrder"];
    expect(sym.kind).toBe("endpoint");
    expect((sym.shape as any).fields.request.type).toEqual({ kind: "ref", name: "PlaceOrderRequest" });
    expect((sym.shape as any).fields.response.type).toEqual({ kind: "ref", name: "Order" });
  });

  it("models a streaming rpc as an array of the streamed message", () => {
    const surface = extract(`
      service OrderService {
        rpc WatchOrders (WatchRequest) returns (stream Order);
      }
    `);
    const fields = (surface.symbols["OrderService.WatchOrders"].shape as any).fields;
    expect(fields.request.type).toEqual({ kind: "ref", name: "WatchRequest" });
    expect(fields.response.type).toEqual({ kind: "array", items: { kind: "ref", name: "Order" } });
  });

  it("keeps nested messages from leaking into the parent's fields", () => {
    const surface = extract(`
      message Order {
        string id = 1;
        message Line { string sku = 1; }
        repeated Line lines = 2;
      }
    `);
    const fields = (surface.symbols.Order.shape as any).fields;
    expect(Object.keys(fields).sort()).toEqual(["id", "lines"]);
    expect(fields.lines.type).toEqual({ kind: "array", items: { kind: "ref", name: "Line" } });
    // The nested message is still a symbol in its own right.
    expect(surface.symbols.Line.kind).toBe("type");
  });

  it("strips a qualified type down to the name the differ compares", () => {
    const surface = extract(`message Order { shop.v1.Customer customer = 1; }`);
    expect((surface.symbols.Order.shape as any).fields.customer.type).toEqual({
      kind: "ref",
      name: "Customer",
    });
  });
});
