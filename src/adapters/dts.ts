import { createRequire } from "node:module";
import { join } from "node:path";
import type { Field, ShapeType, SurfaceSymbol } from "../surface/types";
import type { SurfaceAdapter, SurfaceRole } from "./index";

/**
 * TypeScript declaration adapter.
 *
 * The point of this adapter is that the shard does not hand-write its surface
 * at all: it runs `tsc --emitDeclarationOnly` and the emitted `.d.ts` becomes
 * the declared surface. A declaration produced by the build cannot disagree
 * with the code without the build itself failing, which is the strongest form
 * of the "declared surface" the design doc describes.
 *
 * TypeScript is resolved from the SHARD's own dependency tree, never bundled.
 * Bundling the compiler would multiply the shipped `dist/cli.mjs` many times
 * over for a dependency every TypeScript shard already has, and the plugin
 * cache carries no `node_modules` of its own.
 */

type TsModule = typeof import("typescript");

const cache = new Map<string, TsModule>();

function loadTypeScript(shardDir: string, source: string): TsModule {
  const cached = cache.get(shardDir);
  if (cached) return cached;
  try {
    // Resolved relative to the shard, so a multi-stack workspace can hold
    // shards on different TypeScript versions without them fighting.
    const req = createRequire(join(shardDir, "__sharding__.js"));
    const ts = req("typescript") as TsModule;
    cache.set(shardDir, ts);
    return ts;
  } catch {
    throw new Error(
      `${source}: the dts adapter needs TypeScript resolvable from ${shardDir}, but \`require("typescript")\` failed there. ` +
        `Install it in the shard (\`npm install --save-dev typescript\`) - the adapter reads the declarations your own build emits.`,
    );
  }
}

function unsupported(ts: TsModule, node: any, source: string, path: string): never {
  throw new Error(
    `${source}: ${path} uses a TypeScript type the dts adapter cannot represent structurally ` +
      `(${ts.SyntaxKind[node.kind]}). The canonical surface supports primitives, objects, arrays, ` +
      `string-literal unions, and named references. Simplify the declaration or declare this slice with the identity adapter.`,
  );
}

function isNullish(ts: TsModule, node: any): boolean {
  return (
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    node.kind === ts.SyntaxKind.VoidKeyword ||
    (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword)
  );
}

function toShape(ts: TsModule, node: any, source: string, path: string): ShapeType {
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { kind: "primitive", name: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { kind: "primitive", name: "number" };
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "primitive", name: "boolean" };
    case ts.SyntaxKind.NullKeyword:
      return { kind: "primitive", name: "null" };
  }

  if (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "primitive", name: "null" };
  }
  if (ts.isArrayTypeNode(node)) {
    return { kind: "array", items: toShape(ts, node.elementType, source, `${path}[]`) };
  }
  if (ts.isTypeLiteralNode(node)) {
    return { kind: "object", fields: membersToFields(ts, node.members, source, path) };
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return toShape(ts, node.type, source, path);
  }

  if (ts.isUnionTypeNode(node)) {
    // `T | undefined` is optionality, which the surface already models with
    // `required`, so it is unwrapped rather than treated as a shape.
    const meaningful = node.types.filter((t: any) => !isNullish(ts, t));
    if (meaningful.length === 0) return { kind: "primitive", name: "null" };
    if (meaningful.length === 1) return toShape(ts, meaningful[0], source, path);
    if (meaningful.every((t: any) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))) {
      return { kind: "enum", values: meaningful.map((t: any) => t.literal.text) };
    }
    unsupported(ts, node, source, path);
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    // Array<T> and ReadonlyArray<T> are arrays written the other way round.
    if ((name === "Array" || name === "ReadonlyArray") && node.typeArguments?.length === 1) {
      return { kind: "array", items: toShape(ts, node.typeArguments[0], source, `${path}[]`) };
    }
    return { kind: "ref", name };
  }

  unsupported(ts, node, source, path);
}

function membersToFields(ts: TsModule, members: any, source: string, path: string): Record<string, Field> {
  const fields: Record<string, Field> = {};
  for (const member of members) {
    if (!member.name) continue;
    const name = member.name.getText();
    const fieldPath = `${path}.${name}`;

    if (ts.isPropertySignature(member)) {
      if (!member.type) unsupported(ts, member, source, fieldPath);
      fields[name] = {
        type: toShape(ts, member.type, source, fieldPath),
        required: member.questionToken === undefined,
      };
      continue;
    }
    if (ts.isMethodSignature(member)) {
      fields[name] = { type: signatureToShape(ts, member, source, fieldPath), required: true };
      continue;
    }
    unsupported(ts, member, source, fieldPath);
  }
  return fields;
}

/**
 * A callable becomes an object of `params` and `returns`. Modeling it in the
 * same primitives as everything else is what lets the one differ report a
 * changed parameter type with the same precision as a changed field.
 */
function signatureToShape(ts: TsModule, node: any, source: string, path: string): ShapeType {
  const params: Record<string, Field> = {};
  for (const p of node.parameters) {
    const name = p.name.getText();
    if (!p.type) unsupported(ts, p, source, `${path}.params.${name}`);
    params[name] = {
      type: toShape(ts, p.type, source, `${path}.params.${name}`),
      required: p.questionToken === undefined && p.initializer === undefined,
    };
  }
  return {
    kind: "object",
    fields: {
      params: { type: { kind: "object", fields: params }, required: true },
      returns: {
        type: node.type
          ? toShape(ts, node.type, source, `${path}.returns`)
          : ({ kind: "primitive", name: "null" } as ShapeType),
        required: true,
      },
    },
  };
}

function isExported(ts: TsModule, node: any): boolean {
  return node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

export const dtsAdapter: SurfaceAdapter = {
  name: "dts",
  locate(shardDir: string, slice: string, role: SurfaceRole): string {
    return role === "consumed"
      ? join(shardDir, "surface", "consumed", `${slice}.d.ts`)
      : join(shardDir, "surface", `${slice}.d.ts`);
  },
  parse(raw: string, slice: string, source: string): unknown {
    // `source` doubles as the shard-relative anchor for resolving TypeScript:
    // locate() built it, so its directory is inside the shard.
    const shardDir = source.replace(/[/\\]surface[/\\].*$/, "");
    const ts = loadTypeScript(shardDir, source);
    const sf = ts.createSourceFile(source, raw, ts.ScriptTarget.Latest, true);

    const symbols: Record<string, SurfaceSymbol> = {};
    for (const stmt of sf.statements) {
      // Only the exported declarations are surface. Anything else in the
      // emitted file is an implementation detail the consumer cannot reach.
      if (!isExported(ts, stmt)) continue;

      if (ts.isInterfaceDeclaration(stmt)) {
        const name = stmt.name.text;
        symbols[name] = {
          name,
          kind: "type",
          shape: { kind: "object", fields: membersToFields(ts, stmt.members, source, name) },
        };
      } else if (ts.isTypeAliasDeclaration(stmt)) {
        const name = stmt.name.text;
        symbols[name] = { name, kind: "type", shape: toShape(ts, stmt.type, source, name) };
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        const name = stmt.name.text;
        symbols[name] = { name, kind: "function", shape: signatureToShape(ts, stmt, source, name) };
      }
    }

    return { slice, symbols };
  },
};
