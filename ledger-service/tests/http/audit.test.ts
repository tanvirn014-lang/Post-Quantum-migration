import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, type TestApp } from "../helpers/test-app.js";

describe("audit API", () => {
  let t: TestApp;
  let auditor: { token: string };

  beforeEach(async () => {
    t = await createTestApp();
    auditor = await t.staff("auditor");
  });

  it("records money movements with actor, resource and correlation id", async () => {
    const operator = await t.staff("operator");
    const c = await t.customer();
    const open = (id: string) =>
      t.app.inject({ method: "POST", url: "/accounts", headers: t.bearer(operator.token), payload: { ownerCustomerId: id, currency: "BDT", allowOverdraft: true } });
    const a = (await open(c.customer.id)).json();
    const b = (await open(c.customer.id)).json();
    const transfer = await t.app.inject({
      method: "POST",
      url: "/transfers",
      headers: { ...t.bearer(c.token), "idempotency-key": randomUUID(), "x-request-id": "corr-0123456789" },
      payload: { fromAccountId: a.id, toAccountId: b.id, amountMinorUnits: "250", currency: "BDT", description: "rent" },
    });
    assert.strictEqual(transfer.statusCode, 201);

    const res = await t.app.inject({ method: "GET", url: "/audit/events?action=transfer.create", headers: t.bearer(auditor.token) });
    assert.strictEqual(res.statusCode, 200);
    const [event] = res.json().events;
    assert.strictEqual(event.actorUserId, c.user.id);
    assert.strictEqual(event.actorRole, "customer");
    assert.strictEqual(event.resourceId, transfer.json().id);
    assert.strictEqual(event.correlationId, "corr-0123456789");
    assert.strictEqual(event.details.amountMinorUnits, "250");
    assert.match(event.hash, /^[0-9a-f]{64}$/);
  });

  it("pages newest-first with a cursor and validates filters", async () => {
    for (let i = 0; i < 5; i++) await t.login("missing@bank.test");
    const first = (await t.app.inject({ method: "GET", url: "/audit/events?limit=2", headers: t.bearer(auditor.token) })).json();
    assert.strictEqual(first.events.length, 2);
    assert.ok(first.events[0].seq > first.events[1].seq);
    assert.ok(first.nextBeforeSeq);
    const next = (await t.app.inject({ method: "GET", url: `/audit/events?limit=2&beforeSeq=${first.nextBeforeSeq}`, headers: t.bearer(auditor.token) })).json();
    assert.ok(next.events.every((e: { seq: number }) => e.seq < first.nextBeforeSeq));
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/audit/events?limit=9999", headers: t.bearer(auditor.token) })).statusCode, 400);
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/audit/events?outcome=bogus", headers: t.bearer(auditor.token) })).statusCode, 400);
  });

  it("verifies an intact chain and reports tampering with the first broken sequence number", async () => {
    await t.login("missing@bank.test");
    await t.login("missing@bank.test");
    const intact = (await t.app.inject({ method: "GET", url: "/audit/verify", headers: t.bearer(auditor.token) })).json();
    assert.strictEqual(intact.valid, true);
    assert.ok(intact.eventsChecked >= 2);

    t.stores.audit.tamperForTest(1, (e) => {
      e.outcome = "failure";
    });
    const broken = (await t.app.inject({ method: "GET", url: "/audit/verify", headers: t.bearer(auditor.token) })).json();
    assert.strictEqual(broken.valid, false);
    assert.strictEqual(broken.brokenAtSeq, 1);
  });

  it("does not expose raw user agents or ip-less internals beyond the documented fields", async () => {
    await t.login("missing@bank.test");
    const [event] = (await t.app.inject({ method: "GET", url: "/audit/events", headers: t.bearer(auditor.token) })).json().events;
    assert.deepStrictEqual(Object.keys(event).sort(), [
      "action",
      "actorRole",
      "actorUserId",
      "correlationId",
      "details",
      "hash",
      "id",
      "ip",
      "occurredAt",
      "outcome",
      "resourceId",
      "resourceType",
      "seq",
    ]);
  });
});
