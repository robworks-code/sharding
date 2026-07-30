# The canonical surface format

Every file the checker reads - contract slices and shard surfaces alike - is a
**canonical structural surface**: a JSON object with exactly two top-level keys,
`slice` and `symbols`.

This is the format's single most common mistake. A free-form shape like
`{"provides": [...], "operations": [...]}` is not a surface, and the loader
rejects it rather than guessing. Everything below describes the one shape that
works.

```json
{
  "slice": "OrderAPI",
  "symbols": {
    "placeOrder": { "name": "placeOrder", "kind": "endpoint", "shape": { "...": "..." } }
  }
}
```

| Key | Type | Meaning |
| --- | --- | --- |
| `slice` | non-empty string | The contract slice this file declares. Slice names key the whole graph - the manifest's `provides`/`consumes` lists, the contract's slice map, and the filename all refer to the same name. |
| `symbols` | object | Map of symbol name to symbol. The key and the symbol's own `name` should match; the differ reports by key. |

## Symbols

```json
{ "name": "placeOrder", "kind": "endpoint", "shape": { "kind": "object", "fields": {} } }
```

`kind` is one of:

| Symbol kind | Use for |
| --- | --- |
| `type` | A data shape - a record, a DTO, a shared model. |
| `endpoint` | A callable network surface. Conventionally shaped as an object with `request` and `response` fields. |
| `function` | A callable in-process surface. |
| `event` | A published message or domain event. |

`kind` is compared before shape. Two symbols with the same name but different
kinds produce a `kind-mismatch` finding and the shapes are not compared - a type
that became an endpoint is a redesign, not a field drift.

## Shapes

A `shape` is a recursive union discriminated on `kind`:

| Shape kind | Fields | Example |
| --- | --- | --- |
| `primitive` | `name`: `"string" \| "number" \| "boolean" \| "null"` | `{"kind": "primitive", "name": "string"}` |
| `object` | `fields`: map of field name to `{type, required}` | `{"kind": "object", "fields": {"id": {"type": {...}, "required": true}}}` |
| `array` | `items`: a shape | `{"kind": "array", "items": {"kind": "primitive", "name": "string"}}` |
| `enum` | `values`: array of strings | `{"kind": "enum", "values": ["pending", "shipped"]}` |
| `ref` | `name`: another symbol's name | `{"kind": "ref", "name": "Order"}` |

Notes that matter in practice:

- **`required` is not optional.** Every entry in `fields` is `{type, required}`,
  and `required` is compared - flipping a field from required to optional is a
  `required-mismatch` finding, because it changes what a consumer may rely on.
- **`enum` comparison is order-insensitive** but exact on membership. Adding or
  removing a value is an `enum-mismatch`.
- **`ref` is compared by name only.** The differ does not follow it. A `ref` to a
  symbol that is itself a declared slice symbol is how shapes compose across
  files without inlining.

## What the differ reports

Each finding is `{slice, kind, location, expected?, actual?}`, where `location`
is a dotted path from the symbol name (`placeOrder.request.order`, with `[]` for
array elements).

| Finding kind | Means |
| --- | --- |
| `missing-symbol` | The contract declares it; the shard's surface does not. |
| `unexpected-symbol` | The shard's surface declares it; the contract does not. |
| `kind-mismatch` | Same name, different symbol kind. |
| `missing-field` / `extra-field` | Object field present on one side only. |
| `type-mismatch` | Same location, incompatible shape kind or primitive name. |
| `required-mismatch` | Same field, different `required`. |
| `enum-mismatch` | Same enum, different value set. |

## Adapter selection

The adapter is recorded **per shard** in `.sharding/manifest.yaml` and decides
which file on disk the shard's surface is read from. The checker core never
knows the difference - it only ever diffs two canonical surfaces.

```yaml
shards:
  orders:
    dir: shards/orders
    adapter: identity        # <- selects how surface/ is read
    provides: [OrderAPI, Order]
    consumes: []
```

Both roles use the same adapter. A provided slice is read from `surface/`, a
consumed one from `surface/consumed/`, with the same filename convention:

| Adapter | Filename for slice `X` | Reads |
| --- | --- | --- |
| `identity` | `X.json` | The canonical surface itself |
| `jsonschema` | `X.schema.json` | A JSON Schema document |
| `dts` | `X.d.ts` | TypeScript declarations |
| `openapi` | `X.openapi.json` or `X.openapi.yaml` | An OpenAPI 3 document |
| `protobuf` | `X.proto` | proto3 definitions |

- **`identity`** - the file *is* the canonical surface, written by hand or
  emitted by your build. No translation happens.
- **`jsonschema`** - the schema's `title` becomes the single symbol name
  (falling back to the slice name); `type: integer` maps to the `number`
  primitive; a node carrying `properties` without an explicit `type` is still
  treated as an object; `$ref` becomes a `ref` to the final path segment.
- **`dts`** - reads what `tsc --emitDeclarationOnly` emits. Only **exported**
  declarations are surface. Interfaces and type aliases become `type` symbols,
  functions become `function` symbols shaped as `{params, returns}`, `?:`
  becomes `required: false`, and a union of string literals becomes an `enum`.
  A type it cannot represent structurally (an intersection, a mapped type) is a
  **hard error naming the declaration** rather than a guess. TypeScript is
  resolved from the shard's own `node_modules`, so the shard needs it installed.
- **`openapi`** - every operation becomes an `endpoint` shaped as
  `{request, response}`, keyed by `operationId` (falling back to `METHOD /path`).
  Every `components.schemas` entry becomes a `type`, and operations refer to
  them by `ref`, so a change to a shared model is reported once at the model
  rather than once per endpoint that mentions it. A parameter's `in` (path /
  query / header) is deliberately not part of the shape.
- **`protobuf`** - messages become `type` symbols, enums become `enum` shapes,
  and each `rpc` becomes an `endpoint` named `Service.Method`. Scalars map onto
  the canonical primitives, `map<K,V>` is modeled as an array of `V`, and a
  streaming rpc as an array of the streamed message. Every proto3 field is
  `required: false`, because proto3 has no required fields - claiming otherwise
  would manufacture `required-mismatch` findings against another adapter's view
  of the same slice. Imports are not resolved: a type from another file becomes
  a `ref` by name, which is exactly what the differ compares.

Projects may be multi-stack: each shard picks its own adapter and every shard
still diffs against the same contract. A stack with no adapter degrades honestly
to gate-only rather than faking a green check.

## Contract files

The contract's slice files live in `contract/interfaces/` and `contract/schemas/`.
Both directories are loaded into one flat slice map, so:

- Every `.json` file in either directory must be a canonical surface. A file
  missing `slice` or `symbols` is a **hard error naming the file**, not a
  skipped file. (Before this was enforced, a malformed file silently keyed the
  map at `undefined` and every shard reported a spurious `missing-symbol`.)
- A slice name may be declared **once** across both directories. A duplicate is
  a hard error naming the second file.
- The split between `interfaces/` and `schemas/` is organizational only -
  behavioral surface versus shared data shapes. Nothing in the engine treats
  them differently.

## A worked example

`examples/demo/` is a two-shard graph: `orders` provides an Order API, `gateway`
consumes it. Both use the `identity` adapter.

**Contract** - `contract/schemas/order.json` declares the shared data shape:

```json
{
  "slice": "Order",
  "symbols": {
    "Order": {
      "name": "Order",
      "kind": "type",
      "shape": {
        "kind": "object",
        "fields": {
          "id":    { "type": { "kind": "primitive", "name": "string" }, "required": true },
          "total": { "type": { "kind": "primitive", "name": "number" }, "required": true }
        }
      }
    }
  }
}
```

**Contract** - `contract/interfaces/orderapi.json` declares the behavioral
surface, referring to the shape above by `ref` rather than inlining it:

```json
{
  "slice": "OrderAPI",
  "symbols": {
    "placeOrder": {
      "name": "placeOrder",
      "kind": "endpoint",
      "shape": {
        "kind": "object",
        "fields": {
          "request": {
            "type": {
              "kind": "object",
              "fields": {
                "order": { "type": { "kind": "ref", "name": "Order" }, "required": true }
              }
            },
            "required": true
          },
          "response": {
            "type": {
              "kind": "object",
              "fields": {
                "id": { "type": { "kind": "primitive", "name": "string" }, "required": true }
              }
            },
            "required": true
          }
        }
      }
    }
  }
}
```

**Provider** - `shards/orders/surface/OrderAPI.json` declares what the shard
actually exposes. Under the `identity` adapter it is the same canonical shape;
`/shard-check` diffs it against the contract slice of the same name.

**Consumer** - `shards/gateway/surface/consumed/OrderAPI.json` snapshots the
slice as the gateway built against it. If the conductor later narrows
`placeOrder`, the gateway's snapshot no longer matches the frozen contract and
the consume-side check reports it - which is how a contract change under a shard
that was not looking gets caught.

## Related

- [`docs/design.md`](design.md) - the mechanism in full, including why the
  surface is *declared* rather than parsed out of code.
- [`skills/sharding/SKILL.md`](../skills/sharding/SKILL.md) - the in-session
  guidance for working inside a shard or as the conductor.
