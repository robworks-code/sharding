# checkout

Owns the cart. Its surface is the declaration file its own build emits, so the
declared surface cannot disagree with the code without the build failing.

- Adapter: `dts` - reads `surface/<Slice>.d.ts` for both roles, resolving TypeScript from this shard's own `node_modules`. A TypeScript shard must have `typescript` installed; the compiler is deliberately never bundled into the CLI.
- Provides: `Cart` - an interface, a supporting record, a string-literal union and an exported function, which become `type`, `type`, `type` (enum shape) and `function` symbols.
- Consumes: `Product`.
- Boundary: this shard may read only its own directory and the read-only `contract/`. It may not read or write any sibling shard, and it may not write the contract - contract changes come only from the conductor via `/shard-contract`.
