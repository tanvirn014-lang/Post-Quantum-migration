import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { LedgerService } from "../../src/app/ledger-service.js";
import { MemoryLedgerStore } from "../../src/adapters/memory/ledger-store.js";
import { buildServer } from "../../src/http/server.js";

describe("HTTP API", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const service = new LedgerService(new MemoryLedgerStore());
    app = buildServer(service, { logger: false });
  });

  async function createAccount(currency = "BDT", allowOverdraft = false) {
    const res = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: { ownerCustomerId: randomUUID(), currency, allowOverdraft },
    });
    assert.strictEqual(res.statusCode, 201);
    return res.json();
  }

  it("creates and fetches an account", async () => {
    const created = await createAccount("bdt");
    assert.strictEqual(created.balanceMinorUnits, "0");
    assert.strictEqual(created.currency, "BDT");

    const fetched = await app.inject({ method: "GET", url: `/accounts/${created.id}` });
    assert.strictEqual(fetched.statusCode, 200);
    assert.strictEqual(fetched.json().id, created.id);
  });

  it("returns 404 for an unknown account", async () => {
    const res = await app.inject({ method: "GET", url: `/accounts/${randomUUID()}` });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.json().error.code, "ACCOUNT_NOT_FOUND");
  });

  it("rejects account creation with an invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: { ownerCustomerId: "not-a-uuid", currency: "BD" },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error.code, "VALIDATION_ERROR");
  });

  it("requires an Idempotency-Key header to post a transfer", async () => {
    const a = await createAccount("BDT", true);
    const b = await createAccount("BDT");

    const res = await app.inject({
      method: "POST",
      url: "/transfers",
      payload: { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "100", currency: "BDT", description: "x" },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error.code, "MISSING_IDEMPOTENCY_KEY");
  });

  it("transfers money end-to-end through the HTTP API", async () => {
    const a = await createAccount("BDT", true);
    const b = await createAccount("BDT");

    const res = await app.inject({
      method: "POST",
      url: "/transfers",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        fromAccountId: a.id,
        toAccountId: b.id,
        amountMinorUnits: "5000",
        currency: "BDT",
        description: "bKash cash-in",
      },
    });
    assert.strictEqual(res.statusCode, 201);
    const transaction = res.json();
    assert.strictEqual(transaction.description, "bKash cash-in");

    const balanceB = await app.inject({ method: "GET", url: `/accounts/${b.id}` });
    assert.strictEqual(balanceB.json().balanceMinorUnits, "5000");

    const fetchedTx = await app.inject({ method: "GET", url: `/transactions/${transaction.id}` });
    assert.strictEqual(fetchedTx.statusCode, 200);
    assert.strictEqual(fetchedTx.json().postings.length, 2);
  });

  it("returns 409 when a transfer would overdraw a non-overdraft account", async () => {
    const a = await createAccount("BDT", false);
    const b = await createAccount("BDT");

    const res = await app.inject({
      method: "POST",
      url: "/transfers",
      headers: { "idempotency-key": randomUUID() },
      payload: { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "100", currency: "BDT", description: "x" },
    });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.json().error.code, "INSUFFICIENT_FUNDS");
  });

  it("replays a retried transfer idempotently instead of posting it twice", async () => {
    const a = await createAccount("BDT", true);
    const b = await createAccount("BDT");
    const idempotencyKey = randomUUID();
    const payload = {
      fromAccountId: a.id,
      toAccountId: b.id,
      amountMinorUnits: "1000",
      currency: "BDT",
      description: "retry-safe",
    };

    const first = await app.inject({
      method: "POST",
      url: "/transfers",
      headers: { "idempotency-key": idempotencyKey },
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/transfers",
      headers: { "idempotency-key": idempotencyKey },
      payload,
    });

    assert.strictEqual(first.json().id, second.json().id);
    const balanceB = await app.inject({ method: "GET", url: `/accounts/${b.id}` });
    assert.strictEqual(balanceB.json().balanceMinorUnits, "1000");
  });
});
