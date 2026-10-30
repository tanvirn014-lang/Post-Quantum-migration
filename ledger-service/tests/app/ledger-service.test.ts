import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { LedgerService } from "../../src/app/ledger-service.js";
import { MemoryLedgerStore } from "../../src/adapters/memory/ledger-store.js";
import {
  AccountNotFoundError,
  CurrencyMismatchError,
  IdempotencyKeyReusedError,
  InsufficientFundsError,
} from "../../src/domain/errors.js";

describe("LedgerService (backed by MemoryLedgerStore)", () => {
  let service: LedgerService;

  beforeEach(() => {
    service = new LedgerService(new MemoryLedgerStore());
  });

  async function fundedAccount(amount: bigint, currency = "BDT") {
    const source = await service.createAccount({ ownerCustomerId: randomUUID(), currency, allowOverdraft: true });
    const dest = await service.createAccount({ ownerCustomerId: randomUUID(), currency });
    await service.transfer({
      idempotencyKey: `fund-${dest.id}`,
      fromAccountId: source.id,
      toAccountId: dest.id,
      amountMinorUnits: amount,
      currency,
      description: "test funding",
    });
    return (await service.getAccount(dest.id))!;
  }

  it("creates an account with a zero starting balance", async () => {
    const account = await service.createAccount({ ownerCustomerId: randomUUID(), currency: "bdt" });
    assert.strictEqual(account.balanceMinorUnits, 0n);
    assert.strictEqual(account.currency, "BDT");
    assert.strictEqual(account.status, "active");
  });

  it("moves money between two accounts and updates both balances", async () => {
    const from = await fundedAccount(10_000n);
    const to = await service.createAccount({ ownerCustomerId: randomUUID(), currency: "BDT" });

    await service.transfer({
      idempotencyKey: randomUUID(),
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinorUnits: 2_500n,
      currency: "BDT",
      description: "rent split",
    });

    assert.strictEqual((await service.getAccount(from.id))!.balanceMinorUnits, 7_500n);
    assert.strictEqual((await service.getAccount(to.id))!.balanceMinorUnits, 2_500n);
  });

  it("refuses to overdraw an account that does not allow overdraft", async () => {
    const from = await fundedAccount(1_000n);
    const to = await service.createAccount({ ownerCustomerId: randomUUID(), currency: "BDT" });

    await assert.rejects(
      () =>
        service.transfer({
          idempotencyKey: randomUUID(),
          fromAccountId: from.id,
          toAccountId: to.id,
          amountMinorUnits: 5_000n,
          currency: "BDT",
          description: "should fail",
        }),
      InsufficientFundsError,
    );

    // balances must be unchanged after the rejected transfer
    assert.strictEqual((await service.getAccount(from.id))!.balanceMinorUnits, 1_000n);
  });

  it("replays an idempotent retry with the identical payload instead of double-posting", async () => {
    const from = await fundedAccount(10_000n);
    const to = await service.createAccount({ ownerCustomerId: randomUUID(), currency: "BDT" });
    const idempotencyKey = randomUUID();

    const first = await service.transfer({
      idempotencyKey,
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinorUnits: 1_000n,
      currency: "BDT",
      description: "salary",
    });
    const second = await service.transfer({
      idempotencyKey,
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinorUnits: 1_000n,
      currency: "BDT",
      description: "salary",
    });

    assert.strictEqual(second.id, first.id);
    // only ONE transfer should have actually happened
    assert.strictEqual((await service.getAccount(to.id))!.balanceMinorUnits, 1_000n);
  });

  it("rejects reusing an idempotency key with a different payload", async () => {
    const from = await fundedAccount(10_000n);
    const to = await service.createAccount({ ownerCustomerId: randomUUID(), currency: "BDT" });
    const idempotencyKey = randomUUID();

    await service.transfer({
      idempotencyKey,
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinorUnits: 1_000n,
      currency: "BDT",
      description: "salary",
    });

    await assert.rejects(
      () =>
        service.transfer({
          idempotencyKey,
          fromAccountId: from.id,
          toAccountId: to.id,
          amountMinorUnits: 2_000n, // different amount, same key
          currency: "BDT",
          description: "salary",
        }),
      IdempotencyKeyReusedError,
    );
  });

  it("rejects a posting against an unknown account", async () => {
    const to = await service.createAccount({ ownerCustomerId: randomUUID(), currency: "BDT" });
    await assert.rejects(
      () =>
        service.transfer({
          idempotencyKey: randomUUID(),
          fromAccountId: "acc_does-not-exist",
          toAccountId: to.id,
          amountMinorUnits: 100n,
          currency: "BDT",
          description: "bad transfer",
        }),
      AccountNotFoundError,
    );
  });

  it("rejects a posting whose currency does not match the account's currency", async () => {
    const from = await fundedAccount(10_000n, "BDT");
    const usdAccount = await service.createAccount({ ownerCustomerId: randomUUID(), currency: "USD" });

    await assert.rejects(
      () =>
        service.transfer({
          idempotencyKey: randomUUID(),
          fromAccountId: from.id,
          toAccountId: usdAccount.id,
          amountMinorUnits: 100n,
          currency: "BDT",
          description: "cross-currency without FX conversion",
        }),
      CurrencyMismatchError,
    );
  });

  it("records postings queryable per account, most recent first", async () => {
    const from = await fundedAccount(10_000n);
    const to = await service.createAccount({ ownerCustomerId: randomUUID(), currency: "BDT" });

    await service.transfer({
      idempotencyKey: randomUUID(),
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinorUnits: 100n,
      currency: "BDT",
      description: "first",
    });
    await service.transfer({
      idempotencyKey: randomUUID(),
      fromAccountId: from.id,
      toAccountId: to.id,
      amountMinorUnits: 200n,
      currency: "BDT",
      description: "second",
    });

    const postings = await service.listPostingsForAccount(to.id);
    assert.strictEqual(postings.length, 2);
    assert.strictEqual(postings[0]!.amountMinorUnits, 200n); // most recent first
  });
});
