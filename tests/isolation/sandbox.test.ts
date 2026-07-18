import { describe, it, expect } from "vitest";
import { isReadAllowed, isWriteAllowed } from "../../src/isolation/sandbox";

const shard = "/repo/shards/gateway";
const contract = "/repo/contract";

describe("isolation sandbox", () => {
  it("allows reads within its own shard", () => {
    expect(isReadAllowed(shard, contract, "/repo/shards/gateway/src/index.ts")).toBe(true);
  });
  it("allows reads of the contract", () => {
    expect(isReadAllowed(shard, contract, "/repo/contract/schemas/order.json")).toBe(true);
  });
  it("denies reads of a sibling shard", () => {
    expect(isReadAllowed(shard, contract, "/repo/shards/orders/src/secret.ts")).toBe(false);
  });
  it("allows writes inside its own shard", () => {
    expect(isWriteAllowed(shard, contract, "/repo/shards/gateway/out.ts")).toBe(true);
  });
  it("denies writes to the contract", () => {
    expect(isWriteAllowed(shard, contract, "/repo/contract/schemas/order.json")).toBe(false);
  });
  it("denies writes outside the shard", () => {
    expect(isWriteAllowed(shard, contract, "/repo/shards/orders/x.ts")).toBe(false);
  });
});
