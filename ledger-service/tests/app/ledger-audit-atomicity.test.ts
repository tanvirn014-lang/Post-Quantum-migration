import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryAuditStore } from "../../src/adapters/memory/audit-store.js";
import { MemoryLedgerStore } from "../../src/adapters/memory/ledger-store.js";
import type { AuditStore } from "../../src/ports/audit-store.js";
import type { PostTransactionAudit } from "../../src/ports/ledger-store.js";

async function seed(store: MemoryLedgerStore) {
  const a = await store.createAccount({ ownerCustomerId: "c1", currency: "BDT", allowOverdraft: true });
  const b = await store.createAccount({ ownerCustomerId: "c2", currency: "BDT" });
  return { a, b };
}

const postingsFor = (from: string, to: string) => [
  { accountId: from, amountMinorUnits: -500n, currency: "BDT" },
  { accountId: to, amountMinorUnits: 500n, currency: "BDT" },
];

const builderFor: PostTransactionAudit = (t) => ({ action: "transfer.create", resourceType: "transaction", resourceId: t.id, outcome: "success" });

describe("posting + audit atomicity", () => {
  it("records the posting's audit event in the same unit of work", async () => {
    const audit = new MemoryAuditStore();
    const store = new MemoryLedgerStore(audit);
    const { a, b } = await seed(store);
    const txn = await store.postTransaction({ idempotencyKey: "k1", description: "t", postings: postingsFor(a.id, b.id) }, builderFor);
    const events = await audit.list({ limit: 10 });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.action, "transfer.create");
    assert.equal(events[0]!.resourceId, txn.id);
  });

  it("does not commit the posting if the audit append fails (all-or-nothing)", async () => {
    const throwing: Pick<AuditStore, "append"> = {
      async append() {
        throw new Error("audit down");
      },
    };
    const store = new MemoryLedgerStore(throwing);
    const { a, b } = await seed(store);
    await assert.rejects(
      () => store.postTransaction({ idempotencyKey: "k2", description: "t", postings: postingsFor(a.id, b.id) }, builderFor),
      /audit down/,
    );
    assert.equal((await store.getAccount(a.id))!.balanceMinorUnits, 0n, "source balance unchanged");
    assert.equal((await store.getAccount(b.id))!.balanceMinorUnits, 0n, "target balance unchanged");
    assert.equal(await store.getTransactionByIdempotencyKey("k2"), null, "no transaction recorded");
  });

  it("does not write a second audit event for an idempotent replay", async () => {
    const audit = new MemoryAuditStore();
    const store = new MemoryLedgerStore(audit);
    const { a, b } = await seed(store);
    const input = { idempotencyKey: "k3", description: "t", postings: postingsFor(a.id, b.id) };
    await store.postTransaction(input, builderFor);
    await store.postTransaction(input, builderFor);
    assert.equal((await audit.list({ limit: 10 })).length, 1, "the replay returns the original without re-auditing");
  });
});
