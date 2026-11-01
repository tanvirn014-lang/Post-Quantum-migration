import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestApp, type TestApp } from "../helpers/test-app.js";

describe("transaction reversal (operator-only, audited, atomic)", () => {
  let t: TestApp;
  let operatorToken: string;
  let srcId: string;
  let dstId: string;

  beforeEach(async () => {
    t = await createTestApp({});
    operatorToken = (await t.staff("operator")).token;
    const src = await t.deps.ledger.createAccount({ ownerCustomerId: "cust-src", currency: "BDT", allowOverdraft: true });
    const dst = await t.deps.ledger.createAccount({ ownerCustomerId: "cust-dst", currency: "BDT" });
    srcId = src.id;
    dstId = dst.id;
  });
  afterEach(async () => {
    await t.app.close();
  });

  const makeOriginal = () =>
    t.deps.ledger.transfer({ idempotencyKey: `o-${randomUUID()}`, fromAccountId: srcId, toAccountId: dstId, amountMinorUnits: 500n, currency: "BDT", description: "orig" });
  const reverse = (id: string, token: string, reason = "entered twice") =>
    t.app.inject({ method: "POST", url: `/transactions/${id}/reverse`, headers: t.bearer(token), payload: { reason } });

  it("nets the balances back, marks the original reversed, and writes one audit event", async () => {
    const orig = await makeOriginal();
    assert.equal((await t.deps.ledger.getAccount(dstId))!.balanceMinorUnits, 500n);

    const res = await reverse(orig.id, operatorToken);
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(res.json().metadata.context.reverses, orig.id);

    assert.equal((await t.deps.ledger.getAccount(dstId))!.balanceMinorUnits, 0n, "target restored");
    assert.equal((await t.deps.ledger.getAccount(srcId))!.balanceMinorUnits, 0n, "source restored");
    assert.equal((await t.deps.ledger.getTransaction(orig.id))!.transaction.status, "reversed");
    const events = await t.stores.audit.list({ limit: 10, action: "transaction.reverse" });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.resourceId, orig.id);
    assert.deepEqual(await t.deps.ledger.reconcileBalances(), [], "no balance drift after reversal");
  });

  it("refuses to reverse the same transaction twice (409)", async () => {
    const orig = await makeOriginal();
    assert.equal((await reverse(orig.id, operatorToken)).statusCode, 201);
    const second = await reverse(orig.id, operatorToken);
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error.code, "TRANSACTION_NOT_REVERSIBLE");
  });

  it("returns 404 for an unknown transaction", async () => {
    assert.equal((await reverse("txn_does_not_exist", operatorToken)).statusCode, 404);
  });

  it("forbids customers and auditors (reversal is an operator duty)", async () => {
    const orig = await makeOriginal();
    const customer = await t.customer();
    const auditor = await t.staff("auditor");
    assert.equal((await reverse(orig.id, customer.token)).statusCode, 403);
    assert.equal((await reverse(orig.id, auditor.token)).statusCode, 403);
    // The original is untouched by the forbidden attempts.
    assert.equal((await t.deps.ledger.getTransaction(orig.id))!.transaction.status, "posted");
  });
});
