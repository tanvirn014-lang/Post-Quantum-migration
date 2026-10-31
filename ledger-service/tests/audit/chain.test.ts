import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryAuditStore } from "../../src/adapters/memory/audit-store.js";
import { AuditService } from "../../src/app/audit-service.js";
import { GENESIS_HASH, canonicalJson, computeAuditHash } from "../../src/audit/chain.js";

describe("canonicalJson", () => {
  it("is independent of key order and drops undefined", () => {
    assert.strictEqual(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] }, u: undefined }), canonicalJson({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });
});

describe("audit hash chain", () => {
  async function seeded(n = 5) {
    const store = new MemoryAuditStore();
    let tick = 0;
    const service = new AuditService(store, () => new Date(Date.UTC(2026, 10, 1, 10, 0, tick++)));
    for (let i = 0; i < n; i++) {
      await service.record({ action: `test.event.${i}`, outcome: "success", actorUserId: "u1", details: { i } });
    }
    return { store, service };
  }

  it("links each event to the previous hash, starting from the genesis hash", async () => {
    const { store } = await seeded(3);
    const events = await store.listAscending(0, 10);
    assert.strictEqual(events[0]?.prevHash, GENESIS_HASH);
    assert.strictEqual(events[1]?.prevHash, events[0]?.hash);
    assert.strictEqual(events[2]?.prevHash, events[1]?.hash);
    assert.strictEqual(events[0]?.hash, computeAuditHash(GENESIS_HASH, events[0]!));
  });

  it("verifies an untouched chain", async () => {
    const { service } = await seeded(5);
    const result = await service.verify();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.eventsChecked, 5);
    assert.strictEqual(result.brokenAtSeq, null);
  });

  it("verifies an empty log", async () => {
    const result = await new AuditService(new MemoryAuditStore()).verify();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.eventsChecked, 0);
    assert.strictEqual(result.headHash, GENESIS_HASH);
  });

  it("detects an edited event", async () => {
    const { store, service } = await seeded(5);
    store.tamperForTest(3, (e) => {
      e.outcome = "failure";
    });
    const result = await service.verify();
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.brokenAtSeq, 3);
    assert.match(result.reason ?? "", /contents/);
  });

  it("detects an edited detail value", async () => {
    const { store, service } = await seeded(4);
    store.tamperForTest(2, (e) => {
      e.details = { i: 999 };
    });
    assert.strictEqual((await service.verify()).brokenAtSeq, 2);
  });

  it("detects a deleted event in the middle of the chain", async () => {
    const { store, service } = await seeded(5);
    const events = (store as unknown as { events: unknown[] }).events;
    events.splice(2, 1);
    const result = await service.verify();
    assert.strictEqual(result.valid, false);
    assert.match(result.reason ?? "", /link/);
  });

  it("detects a rewritten hash that is internally consistent but breaks the next link", async () => {
    const { store, service } = await seeded(4);
    store.tamperForTest(2, (e) => {
      e.details = { i: 999 };
      e.hash = computeAuditHash(e.prevHash, e);
    });
    const result = await service.verify();
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.brokenAtSeq, 3);
  });

  it("serializes details so later mutation of the caller's object cannot change the stored event", async () => {
    const store = new MemoryAuditStore();
    const service = new AuditService(store);
    const details = { nested: { n: 1 } };
    await service.record({ action: "x", outcome: "success", details });
    details.nested.n = 2;
    assert.strictEqual((await service.verify()).valid, true);
  });
});
