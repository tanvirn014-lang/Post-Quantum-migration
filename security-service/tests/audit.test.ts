import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { FINGERPRINT_A, createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

describe("configuration audit log", () => {
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

  const createPeer = (name: string, certSha256: string) =>
    t.app.inject({ method: "POST", url: "/v1/peers", headers: t.bearer(admin), payload: { name, certSha256, profile: "hybrid-required" } });
  const verify = () => t.app.inject({ method: "GET", url: "/v1/audit/verify", headers: t.bearer(auditor) });

  it("verifies an intact chain of configuration changes", async () => {
    await createPeer("Peer One", FINGERPRINT_A);
    await t.app.inject({ method: "POST", url: "/v1/crypto/config/active", headers: t.bearer(admin), payload: { profile: "hybrid-only" } });
    const result = (await verify()).json();
    assert.strictEqual(result.valid, true);
    assert.ok(result.eventsChecked >= 2);
  });

  it("links every event to its predecessor", async () => {
    await createPeer("Peer One", FINGERPRINT_A);
    await createPeer("Peer Two", "c".repeat(64));
    const events = (await t.app.inject({ method: "GET", url: "/v1/audit/events", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(events.length >= 2, true);
    const { rows } = await pool.query("SELECT seq, prev_hash, hash FROM audit_events ORDER BY seq");
    for (let i = 1; i < rows.length; i++) assert.strictEqual(rows[i].prev_hash, rows[i - 1].hash);
  });

  it("is append-only at the database level", async () => {
    await createPeer("Peer One", FINGERPRINT_A);
    await assert.rejects(pool.query("UPDATE audit_events SET outcome = 'failure'"), /append-only/);
    await assert.rejects(pool.query("DELETE FROM audit_events"), /append-only/);
    await assert.rejects(pool.query("TRUNCATE audit_events"), /append-only/);
  });

  it("detects tampering by someone who bypasses the triggers", async () => {
    await createPeer("Peer One", FINGERPRINT_A);
    await createPeer("Peer Two", "c".repeat(64));
    await createPeer("Peer Three", "d".repeat(64));
    await pool.query("ALTER TABLE audit_events DISABLE TRIGGER USER");
    try {
      await pool.query("UPDATE audit_events SET details = jsonb_set(details, '{name}', '\"Forged\"') WHERE seq = 2");
    } finally {
      await pool.query("ALTER TABLE audit_events ENABLE TRIGGER USER");
    }
    const result = (await verify()).json();
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.brokenAtSeq, 2);
    const recorded = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=audit.verify", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(recorded[0].outcome, "failure", "a failed verification is itself audited as a failure");
  });

  it("keeps the chain linear when changes are made concurrently", async () => {
    const fingerprints = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(2, "0").repeat(32));
    const results = await Promise.all(fingerprints.map((fp, i) => createPeer(`Concurrent ${i}`, fp)));
    assert.ok(results.every((r) => r.statusCode === 201));
    const verification = (await verify()).json();
    assert.strictEqual(verification.valid, true, JSON.stringify(verification));
    assert.strictEqual(verification.eventsChecked, 12);
  });

  it("records permission denials with the actor and the permission that was missing", async () => {
    await t.app.inject({ method: "POST", url: "/v1/peers", headers: t.bearer(auditor), payload: { name: "Nope Peer", certSha256: FINGERPRINT_A, profile: "hybrid-required" } });
    const [denied] = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=authz.denied", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(denied.actorRole, "auditor");
    assert.strictEqual(denied.outcome, "denied");
    assert.strictEqual(denied.details.permission, "peers:manage");
  });

  it("matches ledger-service's audit chain implementation byte for byte (the two must hash identically)", () => {
    // dist/tests/audit.test.js -> repository root
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const theirs = path.join(repoRoot, "ledger-service/src/audit/chain.ts");
    if (!existsSync(theirs)) return; // this package was checked out on its own
    const body = (s: string) => s.replace(/^\/\/ KEEP IN SYNC[^\n]*\n/, "");
    assert.strictEqual(body(readFileSync(path.join(repoRoot, "security-service/src/audit/chain.ts"), "utf8")), body(readFileSync(theirs, "utf8")));
  });
});
