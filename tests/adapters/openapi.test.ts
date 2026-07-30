import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSurface, getAdapter, surfaceExists } from "../../src/adapters/index";

const adapter = getAdapter("openapi");

const DOC = {
  openapi: "3.0.0",
  components: {
    schemas: {
      Order: {
        type: "object",
        properties: { id: { type: "string" }, total: { type: "number" }, status: { enum: ["new", "done"] } },
        required: ["id", "total"],
      },
    },
  },
  paths: {
    "/orders/{id}": {
      get: {
        operationId: "getOrder",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
        },
      },
    },
    "/orders": {
      post: {
        operationId: "placeOrder",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } },
        },
        responses: { "204": {} },
      },
    },
  },
};

function shardWith(contents: string, filename = "Order.openapi.json"): string {
  const dir = mkdtempSync(join(tmpdir(), "shard-oas-"));
  mkdirSync(join(dir, "surface"), { recursive: true });
  writeFileSync(join(dir, "surface", filename), contents);
  return dir;
}

function extract(contents: string, filename?: string) {
  return extractSurface(adapter, shardWith(contents, filename), "Order", "provided");
}

describe("openapi adapter", () => {
  it("maps components.schemas to type symbols", () => {
    const surface = extract(JSON.stringify(DOC));
    expect(surface.symbols.Order.kind).toBe("type");
    const fields = (surface.symbols.Order.shape as any).fields;
    expect(fields.id).toEqual({ type: { kind: "primitive", name: "string" }, required: true });
    expect(fields.status).toEqual({ type: { kind: "enum", values: ["new", "done"] }, required: false });
  });

  it("maps each operation to an endpoint keyed by operationId", () => {
    const surface = extract(JSON.stringify(DOC));
    expect(surface.symbols.getOrder.kind).toBe("endpoint");
    expect(surface.symbols.placeOrder.kind).toBe("endpoint");
  });

  it("refers to shared schemas by ref instead of inlining them", () => {
    // A change to Order should be reported once at Order, not once per
    // endpoint that happens to mention it.
    const surface = extract(JSON.stringify(DOC));
    const response = (surface.symbols.getOrder.shape as any).fields.response.type;
    expect(response).toEqual({ kind: "ref", name: "Order" });
  });

  it("maps parameters and a request body into the request shape", () => {
    const surface = extract(JSON.stringify(DOC));
    const getReq = (surface.symbols.getOrder.shape as any).fields.request.type;
    expect(getReq.fields.id).toEqual({ type: { kind: "primitive", name: "string" }, required: true });

    const postReq = (surface.symbols.placeOrder.shape as any).fields.request.type;
    expect(postReq.fields.body).toEqual({ type: { kind: "ref", name: "Order" }, required: true });
  });

  it("gives a bodyless success response a null shape rather than omitting it", () => {
    const surface = extract(JSON.stringify(DOC));
    const response = (surface.symbols.placeOrder.shape as any).fields.response;
    expect(response).toEqual({ type: { kind: "primitive", name: "null" }, required: true });
  });

  it("falls back to method+path when there is no operationId", () => {
    const surface = extract(
      JSON.stringify({ paths: { "/health": { get: { responses: { "200": {} } } } } }),
    );
    expect(surface.symbols["GET /health"].kind).toBe("endpoint");
  });

  it("reads a YAML document too", () => {
    const yaml = [
      "paths:",
      "  /health:",
      "    get:",
      "      operationId: health",
      "      responses:",
      "        '200':",
      "          content:",
      "            application/json:",
      "              schema:",
      "                type: string",
    ].join("\n");
    const dir = shardWith(yaml, "Order.openapi.yaml");
    expect(surfaceExists(adapter, dir, "Order", "provided")).toBe(true);
    const surface = extractSurface(adapter, dir, "Order", "provided");
    expect((surface.symbols.health.shape as any).fields.response.type).toEqual({
      kind: "primitive",
      name: "string",
    });
  });

  it("names the .json path when neither file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "shard-oas-"));
    expect(surfaceExists(adapter, dir, "Order", "provided")).toBe(false);
    expect(adapter.locate(dir, "Order", "provided")).toMatch(/surface\/Order\.openapi\.json$/);
  });
});

describe("openapi adapter - review regressions", () => {
  it("merges allOf instead of collapsing it to a null primitive", () => {
    const surface = extract(JSON.stringify({
      components: { schemas: { Order: { allOf: [
        { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        { type: "object", properties: { total: { type: "number" } } },
      ] } } },
    }));
    const fields = (surface.symbols.Order.shape as any).fields;
    expect(fields.id).toEqual({ type: { kind: "primitive", name: "string" }, required: true });
    expect(fields.total).toEqual({ type: { kind: "primitive", name: "number" }, required: false });
  });

  it("fails on a multi-branch oneOf rather than inventing a shape", () => {
    expect(() => extract(JSON.stringify({
      components: { schemas: { Order: { oneOf: [{ type: "string" }, { type: "number" }] } } },
    }))).toThrow(/oneOf with 2 branches has no structural equivalent/);
  });

  it("refuses an operationId that collides with a schema name", () => {
    // Operations are written second into the same map, so this silently
    // replaced the schema's type symbol and deleted it from the surface.
    expect(() => extract(JSON.stringify({
      components: { schemas: { getOrder: { type: "object", properties: {} } } },
      paths: { "/o": { get: { operationId: "getOrder", responses: { "200": {} } } } },
    }))).toThrow(/collides with an existing type symbol/);
  });
});
