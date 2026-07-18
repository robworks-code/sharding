# orders

Owns order creation and storage.

- Provides: `OrderAPI` (the `placeOrder` endpoint), `Order` (the order record type).
- Consumes: nothing.
- Boundary: this shard may read only its own directory and the read-only `contract/`. It may not read or write any sibling shard, and it may not write the contract - contract changes come only from the conductor via `/shard-contract`.
