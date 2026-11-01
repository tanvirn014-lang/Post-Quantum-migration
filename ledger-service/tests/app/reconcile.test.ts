import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryAuditStore } from "../../src/adapters/memory/audit-store.js";
import { MemoryLedgerStore } from "../../src/adapters/memory/ledger-store.js";

async function storeWithOnePosting() {
  const store = new MemoryLedgerStore(new MemoryAuditStore());
  const a = await store.createAccount({ ownerCustomerId: "c1", currency: "BDT", allowOverdraft: true });
  const b = await store.createAccount({ ownerCustomerId: "c2", currency: "BDT" });
  await store.postTransaction({
    idempotencyKey: "k",
    description: "t",
    postings: [
      { accountId: a.id, amountMinorUnits: -100n, currency: "BDT" },
      { accountId: b.id, amountMinorUnits: 100n, currency: "BDT" },
    ],
  });
  return { store, a, b };
}

describe("reconcileBalances (integrity sweep)", () => {
  it("returns nothing when every stored balance matches its postings", async () => {
    const { store } = await storeWithOnePosting();
    assert.deepEqual(await store.reconcileBalances(), []);
  });

  it("flags an account whose stored balance drifts from the sum of its postings", async () => {
    const { store, b } = await storeWithOnePosting();
    // Simulate corruption that bypassed the posting path (what a sweep must catch).
    (store as unknown as { accounts: Map<string, { balanceMinorUnits: bigint }> }).accounts.get(b.id)!.balanceMinorUnits = 999n;
    const drifts = await store.reconcileBalances();
    assert.equal(drifts.length, 1);
    assert.equal(drifts[0]!.accountId, b.id);
    assert.equal(drifts[0]!.storedBalanceMinorUnits, 999n);
    assert.equal(drifts[0]!.derivedBalanceMinorUnits, 100n);
  });
});
