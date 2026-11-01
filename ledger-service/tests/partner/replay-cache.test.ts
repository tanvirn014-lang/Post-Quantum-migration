import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AssertionReplayCache } from "../../src/partner/replay-cache.js";

describe("AssertionReplayCache", () => {
  it("accepts a jti once and rejects an immediate repeat", () => {
    const cache = new AssertionReplayCache(60_000);
    assert.strictEqual(cache.checkAndRecord("jti-1"), true, "first use is accepted");
    assert.strictEqual(cache.checkAndRecord("jti-1"), false, "a replay of the same jti is rejected");
    assert.strictEqual(cache.checkAndRecord("jti-2"), true, "a different jti is accepted");
  });

  it("forgets a jti after its TTL, leaving freshness as the only guard", () => {
    let now = 1_000;
    const cache = new AssertionReplayCache(100, () => now);
    assert.strictEqual(cache.checkAndRecord("j"), true);
    now = 1_101; // older than the ttl
    assert.strictEqual(cache.checkAndRecord("j"), true, "pruned after ttl, so it is accepted again");
  });
});
