import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, type TestApp } from "../helpers/test-app.js";

describe("Ledger HTTP API (authenticated)", () => {
  let t: TestApp;
  let operator: { token: string };

  beforeEach(async () => {
    t = await createTestApp();
    operator = await t.staff("operator");
  });

  /** Operator opens an account for a customer; returns the account DTO. */
  async function openAccount(customerId: string, opts: { currency?: string; allowOverdraft?: boolean; kind?: string } = {}) {
    const res = await t.app.inject({
      method: "POST",
      url: "/accounts",
      headers: t.bearer(operator.token),
      payload: { ownerCustomerId: customerId, currency: opts.currency ?? "BDT", allowOverdraft: opts.allowOverdraft ?? false, ...(opts.kind ? { kind: opts.kind } : {}) },
    });
    assert.strictEqual(res.statusCode, 201, res.body);
    return res.json();
  }

  /** Funds an account through the operator-only journal endpoint, from a settlement account. */
  async function fund(accountId: string, amount: string) {
    const bankCustomer = await t.stores.identity.createCustomerWithUser(
      { fullName: "Bank", email: `bank-${randomUUID().slice(0, 6)}@bank.test` },
      { email: `bank-${randomUUID().slice(0, 6)}@bank.test`, passwordHash: "x", mustChangePassword: false },
    );
    const settlement = await openAccount(bankCustomer.customer.id, { allowOverdraft: true, kind: "settlement" });
    const res = await t.app.inject({
      method: "POST",
      url: "/transactions",
      headers: { ...t.bearer(operator.token), "idempotency-key": randomUUID() },
      payload: {
        description: "Funding",
        postings: [
          { accountId: settlement.id, amountMinorUnits: `-${amount}`, currency: "BDT" },
          { accountId, amountMinorUnits: amount, currency: "BDT" },
        ],
      },
    });
    assert.strictEqual(res.statusCode, 201, res.body);
  }

  it("rejects every ledger route without a token", async () => {
    for (const [method, url] of [
      ["GET", "/accounts"],
      ["POST", "/accounts"],
      ["GET", `/accounts/acc_${randomUUID()}`],
      ["POST", "/transfers"],
      ["POST", "/transactions"],
      ["GET", `/transactions/txn_${randomUUID()}`],
    ] as const) {
      const res = await t.app.inject({ method, url });
      assert.strictEqual(res.statusCode, 401, `${method} ${url}`);
      assert.strictEqual(res.json().error.code, "AUTH_REQUIRED");
      assert.ok(res.json().error.requestId);
    }
  });

  it("lets an operator open an account (with kind) for a customer and the customer read it", async () => {
    const c = await t.customer();
    const account = await openAccount(c.customer.id, { currency: "bdt", kind: "savings" });
    assert.strictEqual(account.balanceMinorUnits, "0");
    assert.strictEqual(account.currency, "BDT");
    assert.strictEqual(account.kind, "savings");

    const fetched = await t.app.inject({ method: "GET", url: `/accounts/${account.id}`, headers: t.bearer(c.token) });
    assert.strictEqual(fetched.statusCode, 200);
    assert.strictEqual(fetched.json().id, account.id);

    const list = await t.app.inject({ method: "GET", url: "/accounts", headers: t.bearer(c.token) });
    assert.deepStrictEqual(list.json().map((a: { id: string }) => a.id), [account.id]);
  });

  it("refuses to open an account for a customer that does not exist", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/accounts",
      headers: t.bearer(operator.token),
      payload: { ownerCustomerId: randomUUID(), currency: "BDT" },
    });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.json().error.code, "CUSTOMER_NOT_FOUND");
  });

  it("validates account creation bodies", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/accounts",
      headers: t.bearer(operator.token),
      payload: { ownerCustomerId: "not-a-uuid", currency: "BD" },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error.code, "VALIDATION_ERROR");
  });

  it("returns the same 404 for an unknown account and for another customer's account", async () => {
    const a = await t.customer("A");
    const b = await t.customer("B");
    const accountA = await openAccount(a.customer.id);

    const unknown = await t.app.inject({ method: "GET", url: "/accounts/acc_missing", headers: t.bearer(b.token) });
    const foreign = await t.app.inject({ method: "GET", url: `/accounts/${accountA.id}`, headers: t.bearer(b.token) });
    assert.strictEqual(unknown.statusCode, 404);
    assert.strictEqual(foreign.statusCode, 404);
    assert.strictEqual(foreign.json().error.code, "ACCOUNT_NOT_FOUND");

    const postings = await t.app.inject({ method: "GET", url: `/accounts/${accountA.id}/postings`, headers: t.bearer(b.token) });
    assert.strictEqual(postings.statusCode, 404);
  });

  it("requires an Idempotency-Key header to post a transfer", async () => {
    const c = await t.customer();
    const a = await openAccount(c.customer.id);
    const b = await openAccount(c.customer.id);
    const res = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: t.bearer(c.token),
      payload: { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "100", currency: "BDT", description: "x" },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error.code, "MISSING_IDEMPOTENCY_KEY");
  });

  it("transfers money end-to-end and records server-attested provenance on the transaction", async () => {
    const c = await t.customer();
    const a = await openAccount(c.customer.id);
    const b = await openAccount(c.customer.id);
    await fund(a.id, "9000");

    const res = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { ...t.bearer(c.token), "idempotency-key": randomUUID() },
      payload: { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "5000", currency: "BDT", description: "bKash cash-in" },
    });
    assert.strictEqual(res.statusCode, 201, res.body);
    const transaction = res.json();
    assert.strictEqual(transaction.metadata.context.actor.userId, c.user.id);
    assert.strictEqual(transaction.metadata.context.channel, "api");

    const balanceB = await t.app.inject({ method: "GET", url: `/accounts/${b.id}`, headers: t.bearer(c.token) });
    assert.strictEqual(balanceB.json().balanceMinorUnits, "5000");

    const fetchedTx = await t.app.inject({ method: "GET", url: `/transactions/${transaction.id}`, headers: t.bearer(c.token) });
    assert.strictEqual(fetchedTx.statusCode, 200);
    assert.strictEqual(fetchedTx.json().postings.length, 2);
  });

  it("does not let client metadata spoof the server-attested context", async () => {
    const c = await t.customer();
    const a = await openAccount(c.customer.id);
    const b = await openAccount(c.customer.id);
    await fund(a.id, "1000");
    const res = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { ...t.bearer(c.token), "idempotency-key": randomUUID() },
      payload: { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "100", currency: "BDT", description: "x", metadata: { context: "forged" } },
    });
    assert.strictEqual(res.statusCode, 400, "an object-valued or reserved key must not be accepted as client metadata");
  });

  it("rejects zero and negative transfer amounts (a negative amount would pull money out of the destination)", async () => {
    const attacker = await t.customer("Attacker");
    const victim = await t.customer("Victim");
    const mine = await openAccount(attacker.customer.id);
    const theirs = await openAccount(victim.customer.id);
    await fund(theirs.id, "100000");

    for (const amountMinorUnits of ["-50000", "0", "1.5", "abc", "1".repeat(16)]) {
      const res = await t.app.inject({
        method: "POST",
        url: "/transfers",
        headers: { ...t.bearer(attacker.token), "idempotency-key": randomUUID() },
        payload: { fromAccountId: mine.id, toAccountId: theirs.id, amountMinorUnits, currency: "BDT", description: "x" },
      });
      assert.strictEqual(res.statusCode, 400, `amount ${amountMinorUnits}`);
    }
    const victimAccount = await t.app.inject({ method: "GET", url: `/accounts/${theirs.id}`, headers: t.bearer(victim.token) });
    assert.strictEqual(victimAccount.json().balanceMinorUnits, "100000");
  });

  it("refuses to transfer from an account the caller does not own, without revealing whether it exists", async () => {
    const attacker = await t.customer("Attacker");
    const victim = await t.customer("Victim");
    const mine = await openAccount(attacker.customer.id);
    const theirs = await openAccount(victim.customer.id, { allowOverdraft: true });

    for (const fromAccountId of [theirs.id, "acc_does-not-exist"]) {
      const res = await t.app.inject({
        method: "POST",
        url: "/transfers",
        headers: { ...t.bearer(attacker.token), "idempotency-key": randomUUID() },
        payload: { fromAccountId, toAccountId: mine.id, amountMinorUnits: "100", currency: "BDT", description: "steal" },
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.json().error.code, "FORBIDDEN");
    }
  });

  it("rejects a transfer to the same account", async () => {
    const c = await t.customer();
    const a = await openAccount(c.customer.id, { allowOverdraft: true });
    const res = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { ...t.bearer(c.token), "idempotency-key": randomUUID() },
      payload: { fromAccountId: a.id, toAccountId: a.id, amountMinorUnits: "100", currency: "BDT", description: "x" },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error.code, "SAME_ACCOUNT_TRANSFER");
  });

  it("returns 409 when a transfer would overdraw a non-overdraft account", async () => {
    const c = await t.customer();
    const a = await openAccount(c.customer.id);
    const b = await openAccount(c.customer.id);
    const res = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { ...t.bearer(c.token), "idempotency-key": randomUUID() },
      payload: { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "100", currency: "BDT", description: "x" },
    });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.json().error.code, "INSUFFICIENT_FUNDS");
  });

  it("replays a retried transfer idempotently instead of posting it twice", async () => {
    const c = await t.customer();
    const a = await openAccount(c.customer.id);
    const b = await openAccount(c.customer.id);
    await fund(a.id, "5000");
    const headers = { ...t.bearer(c.token), "idempotency-key": randomUUID() };
    const payload = { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "1000", currency: "BDT", description: "retry-safe" };

    const first = await t.app.inject({ method: "POST", url: "/transfers", headers, payload });
    const second = await t.app.inject({ method: "POST", url: "/transfers", headers, payload });
    assert.strictEqual(first.json().id, second.json().id);
    const balanceB = await t.app.inject({ method: "GET", url: `/accounts/${b.id}`, headers: t.bearer(c.token) });
    assert.strictEqual(balanceB.json().balanceMinorUnits, "1000");
  });

  it("scopes idempotency keys per user: the same key from another user does not replay", async () => {
    const one = await t.customer("One");
    const two = await t.customer("Two");
    const a1 = await openAccount(one.customer.id);
    const b1 = await openAccount(one.customer.id);
    const a2 = await openAccount(two.customer.id);
    const b2 = await openAccount(two.customer.id);
    await fund(a1.id, "1000");
    await fund(a2.id, "1000");
    const key = randomUUID();

    const r1 = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { ...t.bearer(one.token), "idempotency-key": key },
      payload: { fromAccountId: a1.id, toAccountId: b1.id, amountMinorUnits: "100", currency: "BDT", description: "x" },
    });
    const r2 = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { ...t.bearer(two.token), "idempotency-key": key },
      payload: { fromAccountId: a2.id, toAccountId: b2.id, amountMinorUnits: "100", currency: "BDT", description: "x" },
    });
    assert.strictEqual(r2.statusCode, 201);
    assert.notStrictEqual(r1.json().id, r2.json().id);
  });

  it("hides a transaction from customers whose accounts it does not touch", async () => {
    const one = await t.customer("One");
    const two = await t.customer("Two");
    const a = await openAccount(one.customer.id);
    const b = await openAccount(one.customer.id);
    await fund(a.id, "1000");
    const tx = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { ...t.bearer(one.token), "idempotency-key": randomUUID() },
      payload: { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "100", currency: "BDT", description: "x" },
    });
    const id = tx.json().id;
    assert.strictEqual((await t.app.inject({ method: "GET", url: `/transactions/${id}`, headers: t.bearer(two.token) })).statusCode, 404);
    assert.strictEqual((await t.app.inject({ method: "GET", url: `/transactions/${id}`, headers: t.bearer(operator.token) })).statusCode, 200);
  });

  it("returns a consistent error envelope for unknown routes and malformed JSON", async () => {
    const missing = await t.app.inject({ method: "GET", url: "/nope" });
    assert.strictEqual(missing.statusCode, 404);
    assert.strictEqual(missing.json().error.code, "NOT_FOUND");

    const malformed = await t.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    assert.strictEqual(malformed.statusCode, 400);
    assert.strictEqual(malformed.json().error.code, "BAD_REQUEST");
  });
});
