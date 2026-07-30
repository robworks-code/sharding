# pricing

Prices catalog products. Declares its surface as JSON Schema, the artifact its
own validation layer already emits.

- Adapter: `jsonschema` - reads `surface/<Slice>.schema.json` for both roles.
- Provides: `Price`. The schema's `title` is `PriceQuote`, and that is the symbol name - a slice is a unit of coupling, not a type name, and the two are named differently here on purpose.
- Consumes: `Product`, `Money` - snapshotted as schemas, in the same form this shard emits.
- Boundary: this shard may read only its own directory and the read-only `contract/`. It may not read or write any sibling shard, and it may not write the contract - contract changes come only from the conductor via `/shard-contract`.
