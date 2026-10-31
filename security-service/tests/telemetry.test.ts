import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { FINGERPRINT_A, createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

function connectionEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    correlationId: "corr-" + randomUUID().slice(0, 8),
    occurredAt: new Date().toISOString(),
    remoteAddr: "127.0.0.1",
    certSha256: FINGERPRINT_A,
    tlsVersion: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    offeredGroups: [{ code: 0x11ec, name: "X25519MLKEM768" }, { code: 0x1d, name: "X25519" }],
    negotiatedGroup: "X25519MLKEM768",
    negotiatedGroupCode: 0x11ec,
    keyExchange: "hybrid",
    clientKeyShareBytes: 1216,
    serverKeyShareBytes: 1120,
    decision: "allowed-hybrid",
    reason: "hybrid group negotiated",
    handshakeMs: 4.2,
    configVersion: 1,
    ...overrides,
  };
}

describe("policy telemetry", () => {
  let pool: pg.Pool;
  let t: TestApp;
  let admin: string;
  let auditor: string;

  before(async () => {
    pool = await setupPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    t = await createTestApp(pool);
    admin = await t.token("security_admin");
    auditor = await t.token("auditor");
  });
  after(async () => {
    await pool.end();
  });

  const ingest = (events: object[]) => t.app.inject({ method: "POST", url: "/internal/v1/events/connections", headers: t.sidecar, payload: { events } });
  const list = (query = "", token = auditor) => t.app.inject({ method: "GET", url: `/v1/telemetry/connections${query}`, headers: t.bearer(token) });

  it("ingests a batch and returns it newest first", async () => {
    const old = connectionEvent({ occurredAt: new Date(Date.now() - 60_000).toISOString() });
    const recent = connectionEvent();
    const res = await ingest([old, recent]);
    assert.strictEqual(res.statusCode, 202);
    assert.deepStrictEqual(res.json(), { received: 2, accepted: 2 });
    const events = (await list()).json().events;
    assert.deepStrictEqual(events.map((e: { id: string }) => e.id), [recent.id, old.id]);
    assert.strictEqual(events[0].serverKeyShareBytes, 1120);
  });

  it("is idempotent on event id, so a retried batch never duplicates events", async () => {
    const event = connectionEvent();
    await ingest([event]);
    const retry = await ingest([event]);
    assert.deepStrictEqual(retry.json(), { received: 1, accepted: 0 });
    assert.strictEqual((await list()).json().events.length, 1);
  });

  it("derives severity from the decision and ignores any severity the reporter sends", async () => {
    const forged = connectionEvent({ decision: "rejected-violation", keyExchange: "classical", negotiatedGroup: "X25519", negotiatedGroupCode: 0x1d, reason: "classical on hybrid-required peer", severity: "info" });
    await ingest([forged]);
    const [event] = (await list()).json().events;
    assert.strictEqual(event.severity, "critical");
  });

  it("maps every decision to a documented severity", async () => {
    const cases: [string, string][] = [
      ["allowed-hybrid", "info"],
      ["handshake-failed", "low"],
      ["allowed-fallback", "medium"],
      ["rejected-unknown-peer", "high"],
      ["rejected-violation", "critical"],
    ];
    await ingest(cases.map(([decision]) => connectionEvent({ decision, keyExchange: decision === "allowed-hybrid" ? "hybrid" : "classical" })));
    const events = (await list("?limit=10")).json().events;
    for (const [decision, severity] of cases) {
      assert.strictEqual(events.find((e: { decision: string }) => e.decision === decision).severity, severity, decision);
    }
  });

  it("rejects malformed events and oversized batches", async () => {
    for (const bad of [
      connectionEvent({ id: "not-a-uuid" }),
      connectionEvent({ decision: "maybe" }),
      connectionEvent({ keyExchange: "quantum" }),
      connectionEvent({ certSha256: "xyz" }),
      connectionEvent({ handshakeMs: -1 }),
      connectionEvent({ reason: "" }),
      connectionEvent({ configVersion: 0 }),
    ]) {
      assert.strictEqual((await ingest([bad])).statusCode, 400, JSON.stringify(bad).slice(0, 80));
    }
    assert.strictEqual((await ingest([])).statusCode, 400);
    assert.strictEqual((await ingest(Array.from({ length: 101 }, () => connectionEvent()))).statusCode, 400);
  });

  it("filters by decision, key exchange and alert status, and pages with a cursor", async () => {
    await ingest([
      connectionEvent({ occurredAt: new Date(Date.now() - 3000).toISOString() }),
      connectionEvent({ occurredAt: new Date(Date.now() - 2000).toISOString(), decision: "allowed-fallback", keyExchange: "classical", negotiatedGroup: "X25519", negotiatedGroupCode: 0x1d, reason: "classical-allowed peer" }),
      connectionEvent({ occurredAt: new Date(Date.now() - 1000).toISOString(), decision: "rejected-violation", keyExchange: "classical", negotiatedGroup: "X25519", negotiatedGroupCode: 0x1d, reason: "violation" }),
    ]);
    assert.strictEqual((await list("?decision=allowed-fallback")).json().events.length, 1);
    assert.strictEqual((await list("?keyExchange=classical")).json().events.length, 2);
    assert.strictEqual((await list("?alertsOnly=true")).json().events.length, 2);

    const page1 = (await list("?limit=2")).json();
    assert.strictEqual(page1.events.length, 2);
    assert.ok(page1.nextBefore);
    const page2 = (await list(`?limit=2&before=${encodeURIComponent(page1.nextBefore)}`)).json();
    assert.strictEqual(page2.events.length, 1);
    assert.strictEqual((await list("?limit=9999")).statusCode, 400);
    assert.strictEqual((await list("?decision=bogus")).statusCode, 400);
  });

  it("summarises counts and handshake latency percentiles per key exchange", async () => {
    const hybrid = [1, 2, 3, 4, 5].map((ms) => connectionEvent({ handshakeMs: ms }));
    const classical = [1, 1, 1].map((ms) => connectionEvent({ decision: "allowed-fallback", keyExchange: "classical", handshakeMs: ms, negotiatedGroup: "X25519", negotiatedGroupCode: 0x1d }));
    await ingest([...hybrid, ...classical]);
    const summary = (await t.app.inject({ method: "GET", url: "/v1/telemetry/summary?hours=1", headers: t.bearer(auditor) })).json();
    assert.strictEqual(summary.total, 8);
    assert.deepStrictEqual(summary.byKeyExchange, { hybrid: 5, classical: 3 });
    assert.strictEqual(summary.byDecision["allowed-fallback"], 3);
    assert.strictEqual(summary.handshakeMs.hybrid.count, 5);
    assert.strictEqual(summary.handshakeMs.hybrid.p50, 3);
    assert.strictEqual(summary.handshakeMs.hybrid.mean, 3);
    assert.strictEqual(summary.handshakeMs.classical.p50, 1);
    assert.strictEqual(summary.openAlerts, 3);
  });

  it("lists open alerts and lets a security admin acknowledge one, with an audit entry", async () => {
    const violation = connectionEvent({ decision: "rejected-violation", keyExchange: "classical", reason: "violation" });
    const ok = connectionEvent();
    await ingest([violation, ok]);

    const alerts = (await t.app.inject({ method: "GET", url: "/v1/telemetry/alerts", headers: t.bearer(auditor) })).json();
    assert.deepStrictEqual(alerts.map((a: { id: string }) => a.id), [violation.id]);

    const ack = await t.app.inject({ method: "POST", url: `/v1/telemetry/alerts/${violation.id}/acknowledge`, headers: t.bearer(admin), payload: { note: "expected during test" } });
    assert.strictEqual(ack.statusCode, 200, ack.body);
    assert.ok(ack.json().acknowledgedAt);
    assert.strictEqual(ack.json().ackNote, "expected during test");

    assert.deepStrictEqual((await t.app.inject({ method: "GET", url: "/v1/telemetry/alerts", headers: t.bearer(auditor) })).json(), []);
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/telemetry/alerts?includeAcknowledged=true", headers: t.bearer(auditor) })).json().length, 1);
    const audit = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=alert.acknowledge", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(audit.length, 1);
    assert.strictEqual(audit[0].resourceId, violation.id);
  });

  it("refuses to acknowledge a non-alert or unknown event, and forbids auditors from acknowledging", async () => {
    const ok = connectionEvent();
    const violation = connectionEvent({ decision: "rejected-violation", keyExchange: "classical", reason: "v" });
    await ingest([ok, violation]);
    assert.strictEqual((await t.app.inject({ method: "POST", url: `/v1/telemetry/alerts/${ok.id}/acknowledge`, headers: t.bearer(admin), payload: {} })).statusCode, 404);
    assert.strictEqual((await t.app.inject({ method: "POST", url: `/v1/telemetry/alerts/${randomUUID()}/acknowledge`, headers: t.bearer(admin), payload: {} })).statusCode, 404);
    assert.strictEqual((await t.app.inject({ method: "POST", url: `/v1/telemetry/alerts/${violation.id}/acknowledge`, headers: t.bearer(auditor), payload: {} })).statusCode, 403);
  });

  it("keeps the first acknowledgement if two admins race", async () => {
    const violation = connectionEvent({ decision: "rejected-violation", keyExchange: "classical", reason: "v" });
    await ingest([violation]);
    const a = await t.token("security_admin");
    const b = await t.token("security_admin");
    const first = await t.app.inject({ method: "POST", url: `/v1/telemetry/alerts/${violation.id}/acknowledge`, headers: t.bearer(a), payload: { note: "first" } });
    const second = await t.app.inject({ method: "POST", url: `/v1/telemetry/alerts/${violation.id}/acknowledge`, headers: t.bearer(b), payload: { note: "second" } });
    assert.strictEqual(second.json().ackNote, "first");
    assert.strictEqual(second.json().acknowledgedBy, first.json().acknowledgedBy);
  });
});
