# gateway

Public entry point that forwards order placement to the `orders` shard.

- Provides: nothing.
- Consumes: `OrderAPI` (calls `placeOrder`), `Order` (the shape it forwards). Snapshots of both live under `surface/consumed/`.
- Boundary: this shard may read only its own directory and the read-only `contract/`. It may not read or write any sibling shard, and it may not write the contract - contract changes come only from the conductor via `/shard-contract`.
