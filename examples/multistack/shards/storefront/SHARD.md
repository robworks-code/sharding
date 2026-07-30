# storefront

Owns the public HTTP surface. Declares it with the OpenAPI document its
framework emits.

- Adapter: `openapi` - reads `surface/<Slice>.openapi.yaml` or `.openapi.json`. This shard provides YAML and snapshots what it consumes as JSON, because the adapter honors whichever form the generator produced.
- Provides: `StorefrontAPI` - operations become `endpoint` symbols keyed by `operationId`, and `components.schemas` entries become `type` symbols. Operations refer to schemas by `ref` rather than inlining them, so a change to a shared model is reported once at the model.
- Consumes: `Product`.
- Boundary: this shard may read only its own directory and the read-only `contract/`. It may not read or write any sibling shard, and it may not write the contract - contract changes come only from the conductor via `/shard-contract`.
