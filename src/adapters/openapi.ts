import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { jsonSchemaToShape, propertiesToFields } from "../surface/jsonSchemaShape";
import type { Field, SurfaceSymbol } from "../surface/types";
import type { SurfaceAdapter, SurfaceRole } from "./index";

/**
 * OpenAPI adapter.
 *
 * The document is expected to be the one the shard's framework emits, not a
 * hand-written description of intent - that is what makes it a machine-derived
 * surface in the sense the design doc means.
 *
 * Two symbol kinds come out of one document: every operation becomes an
 * `endpoint`, and every `components.schemas` entry becomes a `type`. Operations
 * refer to those schemas by `ref` rather than inlining them, so a change to a
 * shared model is reported once at the model instead of once per endpoint that
 * happens to mention it.
 */

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

function basePath(shardDir: string, role: SurfaceRole): string {
  return role === "consumed" ? join(shardDir, "surface", "consumed") : join(shardDir, "surface");
}

/**
 * Operations are keyed by `operationId` when the document has one, because that
 * is the name the generator and the consumer both use. The method+path fallback
 * is stable but couples the symbol name to the route, so renaming a route reads
 * as a removed endpoint plus an added one - which is honest, and is exactly the
 * drift a reviewer should see.
 */
function operationName(op: any, method: string, path: string): string {
  return op.operationId ?? `${method.toUpperCase()} ${path}`;
}

function requestShape(op: any) {
  const fields: Record<string, Field> = {};

  for (const p of (op.parameters ?? []) as any[]) {
    if (!p?.name) continue;
    // `in` (path/query/header) is deliberately not part of the shape: moving a
    // parameter between query and header is a transport change the structural
    // differ has no vocabulary for, and encoding it would produce findings that
    // read as type drift.
    fields[p.name] = { type: jsonSchemaToShape(p.schema ?? {}), required: p.required === true };
  }

  const body = op.requestBody;
  if (body) {
    const schema = firstContentSchema(body.content);
    if (schema) {
      fields.body = { type: jsonSchemaToShape(schema), required: body.required === true };
    }
  }
  return { kind: "object" as const, fields };
}

function firstContentSchema(content: any): any | undefined {
  if (!content || typeof content !== "object") return undefined;
  // Prefer JSON when the operation offers several representations; the schema
  // is the same shape regardless, and picking deterministically keeps the
  // surface stable across documents that list media types in a different order.
  const preferred = Object.keys(content).find((k) => k.includes("json")) ?? Object.keys(content)[0];
  return preferred ? content[preferred]?.schema : undefined;
}

function responseShape(op: any) {
  const responses = op.responses ?? {};
  const successKey = Object.keys(responses)
    .filter((k) => /^2\d\d$/.test(k))
    .sort()[0];
  const chosen = successKey ? responses[successKey] : responses.default;
  const schema = chosen ? firstContentSchema(chosen.content) : undefined;
  // A documented 204, or an operation with no success body, is a real answer:
  // the response shape is null rather than absent.
  return schema ? jsonSchemaToShape(schema) : ({ kind: "primitive", name: "null" } as const);
}

export const openApiAdapter: SurfaceAdapter = {
  name: "openapi",
  locate(shardDir: string, slice: string, role: SurfaceRole): string {
    const dir = basePath(shardDir, role);
    const json = join(dir, `${slice}.openapi.json`);
    const yaml = join(dir, `${slice}.openapi.yaml`);
    // JSON is the default the error message names; YAML is honored when the
    // shard's generator emits it, which many frameworks do.
    if (!existsSync(json) && existsSync(yaml)) return yaml;
    return json;
  },
  parse(raw: string, slice: string): unknown {
    // YAML is a superset of JSON, so one parser reads both emitted forms.
    const doc = parseYaml(raw) ?? {};
    const symbols: Record<string, SurfaceSymbol> = {};

    for (const [name, schema] of Object.entries((doc.components?.schemas ?? {}) as Record<string, any>)) {
      symbols[name] = {
        name,
        kind: "type",
        shape: schema?.properties || schema?.type === "object"
          ? { kind: "object", fields: propertiesToFields(schema) }
          : jsonSchemaToShape(schema),
      };
    }

    for (const [path, item] of Object.entries((doc.paths ?? {}) as Record<string, any>)) {
      if (!item || typeof item !== "object") continue;
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const name = operationName(op, method, path);
        // Operations are written after schemas into the same map, so an
        // operationId equal to a schema name would silently replace that
        // schema's `type` symbol and delete it from the surface.
        if (symbols[name]) {
          throw new Error(
            `operation "${name}" collides with an existing ${symbols[name].kind} symbol of the same name. ` +
              `Rename the operationId or the schema - a surface cannot hold two symbols under one name.`,
          );
        }
        symbols[name] = {
          name,
          kind: "endpoint",
          shape: {
            kind: "object",
            fields: {
              request: { type: requestShape(op), required: true },
              response: { type: responseShape(op), required: true },
            },
          },
        };
      }
    }

    return { slice, symbols };
  },
};
