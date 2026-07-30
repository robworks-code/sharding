# telemetry

Ingests purchase events. Declares its surface as proto3, the schema its
transport already uses.

- Adapter: `protobuf` - reads `surface/<Slice>.proto` for both roles.
- Provides: `PurchaseEvent` - messages and enums become `type` symbols, and each `rpc` becomes an `endpoint` named `Service.Method`.
- Consumes: `Product`. Every proto3 field is `required: false`, which is why `Product` declares no required fields anywhere in this workspace: proto3 has no `required`, and claiming otherwise would manufacture drift against every other shard's view of the same slice.
- Boundary: this shard may read only its own directory and the read-only `contract/`. It may not read or write any sibling shard, and it may not write the contract - contract changes come only from the conductor via `/shard-contract`.
