# catalog

Owns the product catalog and the shared money type. It is the only provider in
this workspace, so every other shard waits on it in wave 0.

- Adapter: `identity` - reads `surface/<Slice>.json`, which already is the canonical IR.
- Provides: `Product` (the catalog record), `Money` (the shared amount type).
- Consumes: nothing.
- Boundary: this shard may read only its own directory and the read-only `contract/`. It may not read or write any sibling shard, and it may not write the contract - contract changes come only from the conductor via `/shard-contract`.
