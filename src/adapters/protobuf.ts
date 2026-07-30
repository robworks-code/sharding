import { join } from "node:path";
import type { Field, ShapeType, SurfaceSymbol } from "../surface/types";
import type { SurfaceAdapter, SurfaceRole } from "./index";

/**
 * Protobuf adapter (proto3).
 *
 * A hand-written parser rather than a dependency: the surface only needs the
 * declared shape of messages, enums and RPCs, which is a small, stable subset
 * of the grammar. Pulling in a full descriptor toolchain would add a compiler
 * to a bundle that ships inside a plugin cache, to answer a question the text
 * already answers.
 *
 * What it deliberately does NOT do is resolve imports. A `.proto` that pulls
 * types from another file yields `ref` symbols by name, and the differ compares
 * refs by name - so cross-file composition works without this adapter growing
 * an include path and a resolution order.
 */

const SCALAR_TO_PRIMITIVE: Record<string, "string" | "number" | "boolean"> = {
  double: "number", float: "number",
  int32: "number", int64: "number", uint32: "number", uint64: "number",
  sint32: "number", sint64: "number", fixed32: "number", fixed64: "number",
  sfixed32: "number", sfixed64: "number",
  bool: "boolean",
  string: "string",
  // `bytes` has no canonical primitive; string is the honest approximation of
  // "an opaque scalar", and it stays stable across both sides of a diff.
  bytes: "string",
};

/**
 * Strip comments, genuinely leaving string literals alone.
 *
 * A plain `//` line regex is wrong here, and silently so: an `option` carrying
 * a URL (`option (x) = "https://example.com/y";`) loses the rest of its line
 * including the terminating `;`, which un-anchors every field that follows and
 * drops them from the declared surface entirely. Scanning character by
 * character with a string-literal state is the only way to get this right.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function scalarShape(type: string): ShapeType {
  const primitive = SCALAR_TO_PRIMITIVE[type];
  if (primitive) return { kind: "primitive", name: primitive };
  // A non-scalar is a named message or enum - possibly qualified, possibly
  // imported. The last segment is the name the differ compares.
  return { kind: "ref", name: type.split(".").filter(Boolean).pop() ?? type };
}

/**
 * Find the body of a block starting at the `{` that follows `from`, honoring
 * nesting. Returns the body and the index just past its closing brace.
 */
function readBlock(src: string, from: number): { body: string; end: number } | null {
  const open = src.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * Remove nested block constructs so field scanning sees only this level.
 *
 * A closing brace emits a `;`. Without it the nested block's header survives
 * un-terminated - `message Line` followed directly by the next field - and
 * since fields are anchored to a preceding `;`, the field after a nested
 * message silently disappears from the surface.
 */
function withoutNestedBlocks(body: string): string {
  let out = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) out += ";";
    } else if (depth === 0) out += ch;
  }
  return out;
}

const FIELD_RE = /(?:^|;)\s*(repeated\s+|optional\s+)?([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*\d+/g;
const MAP_FIELD_RE = /(?:^|;)\s*map\s*<\s*([A-Za-z_][\w.]*)\s*,\s*([A-Za-z_][\w.]*)\s*>\s*([A-Za-z_]\w*)\s*=\s*\d+/g;

/**
 * Splice `oneof` bodies into the enclosing message.
 *
 * A `oneof` is not a nested type - its members are fields of the parent, and
 * only the grouping is different. Stripping it as a nested block silently drops
 * every branch from the surface, and unlike a nested message they are not
 * recovered as symbols in their own right. They are already `required: false`,
 * which is exactly right: at most one is ever set.
 */
function inlineOneofs(body: string): string {
  let out = body;
  for (;;) {
    const m = /\boneof\s+[A-Za-z_]\w*/.exec(out);
    if (!m) return out;
    const block = readBlock(out, m.index + m[0].length);
    if (!block) return out;
    out = `${out.slice(0, m.index)};${block.body};${out.slice(block.end)}`;
  }
}

function messageFields(body: string): Record<string, Field> {
  const flat = withoutNestedBlocks(inlineOneofs(body));
  const fields: Record<string, Field> = {};

  // Maps first - their `<k, v>` would otherwise confuse the plain field regex.
  for (const m of flat.matchAll(MAP_FIELD_RE)) {
    const [, , valueType, name] = m;
    // A map is modeled as an array of its value type: the canonical surface has
    // no map kind, and what a consumer depends on is the value shape.
    fields[name] = { type: { kind: "array", items: scalarShape(valueType) }, required: false };
  }
  const withoutMaps = flat.replace(MAP_FIELD_RE, ";");

  for (const m of withoutMaps.matchAll(FIELD_RE)) {
    const [, modifier, type, name] = m;
    if (type === "map" || fields[name]) continue;
    const base = scalarShape(type);
    fields[name] = {
      type: modifier?.trim() === "repeated" ? { kind: "array", items: base } : base,
      // proto3 has no required fields; every field is optional on the wire, and
      // claiming otherwise would manufacture required-mismatch findings against
      // any other adapter's view of the same contract slice.
      required: false,
    };
  }
  return fields;
}

function enumValues(body: string): string[] {
  const values: string[] = [];
  for (const m of withoutNestedBlocks(body).matchAll(/(?:^|;)\s*([A-Za-z_]\w*)\s*=\s*-?\d+/g)) {
    values.push(m[1]);
  }
  return values;
}

function collectBlocks(src: string, keyword: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = new RegExp(`\\b${keyword}\\s+([A-Za-z_]\\w*)`, "g");
  for (const m of src.matchAll(re)) {
    const block = readBlock(src, m.index! + m[0].length);
    if (block) out.push({ name: m[1], body: block.body });
  }
  return out;
}

export const protobufAdapter: SurfaceAdapter = {
  name: "protobuf",
  locate(shardDir: string, slice: string, role: SurfaceRole): string {
    return role === "consumed"
      ? join(shardDir, "surface", "consumed", `${slice}.proto`)
      : join(shardDir, "surface", `${slice}.proto`);
  },
  parse(raw: string, slice: string): unknown {
    const src = stripComments(raw);
    const symbols: Record<string, SurfaceSymbol> = {};

    for (const { name, body } of collectBlocks(src, "message")) {
      symbols[name] = { name, kind: "type", shape: { kind: "object", fields: messageFields(body) } };
    }

    for (const { name, body } of collectBlocks(src, "enum")) {
      symbols[name] = { name, kind: "type", shape: { kind: "enum", values: enumValues(body) } };
    }

    // Each rpc becomes an endpoint, named as the service sees it. Streaming is
    // modeled as an array of the streamed message - the shape a consumer
    // handles either way, without inventing a stream kind the differ cannot
    // compare against another adapter's view.
    for (const { name: service, body } of collectBlocks(src, "service")) {
      const rpcRe = /\brpc\s+([A-Za-z_]\w*)\s*\(\s*(stream\s+)?([A-Za-z_][\w.]*)\s*\)\s*returns\s*\(\s*(stream\s+)?([A-Za-z_][\w.]*)\s*\)/g;
      for (const m of body.matchAll(rpcRe)) {
        const [, rpc, reqStream, reqType, resStream, resType] = m;
        const name = `${service}.${rpc}`;
        const wrap = (t: string, streaming: boolean): ShapeType =>
          streaming ? { kind: "array", items: scalarShape(t) } : scalarShape(t);
        symbols[name] = {
          name,
          kind: "endpoint",
          shape: {
            kind: "object",
            fields: {
              request: { type: wrap(reqType, Boolean(reqStream)), required: true },
              response: { type: wrap(resType, Boolean(resStream)), required: true },
            },
          },
        };
      }
    }

    return { slice, symbols };
  },
};
