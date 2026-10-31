import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { FINGERPRINT_A, FINGERPRINT_B, createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

describe("peer registry", () => {
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

  const create = (body: object, token = admin) => t.app.inject({ method: "POST", url: "/v1/peers", headers: t.bearer(token), payload: body });
  const validPeer = { name: "Partner Bank A", certSha256: FINGERPRINT_A, profile: "hybrid-required" };

  it("registers a peer, normalizes colon-separated uppercase fingerprints and exposes it to the sidecar", async () => {
    const colon = FINGERPRINT_A.toUpperCase().match(/../g)!.join(":");
    const res = await create({ ...validPeer, certSha256: colon });
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(res.json().certSha256, FINGERPRINT_A);
    assert.strictEqual(res.json().enabled, true);

    const config = await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar });
    assert.strictEqual(config.statusCode, 200);
    assert.deepStrictEqual(
      config.json().peers.map((p: { name: string; profile: string; certSha256: string }) => [p.name, p.profile, p.certSha256]),
      [["Partner Bank A", "hybrid-required", FINGERPRINT_A]],
    );
  });

  it("bumps the configuration version and writes an audit entry in the same step", async () => {
    const before = (await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar })).json().version;
    const created = await create(validPeer);
    const after = (await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar })).json().version;
    assert.strictEqual(after, before + 1);

    const events = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=peer.create", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].resourceId, created.json().id);
    assert.strictEqual(events[0].details.configVersion, after);
    assert.strictEqual(events[0].outcome, "success");
  });

  it("rejects malformed input", async () => {
    for (const bad of [
      { ...validPeer, certSha256: "abc" },
      { ...validPeer, certSha256: "z".repeat(64) },
      { ...validPeer, profile: "anything-goes" },
      { ...validPeer, name: "<script>" },
      { ...validPeer, name: "x" },
      { name: "No fingerprint", profile: "hybrid-required" },
    ]) {
      const res = await create(bad);
      assert.strictEqual(res.statusCode, 400, JSON.stringify(bad));
      assert.strictEqual(res.json().error.code, "VALIDATION_ERROR");
    }
  });

  it("refuses duplicate names and duplicate certificate fingerprints, leaving no config change behind", async () => {
    assert.strictEqual((await create(validPeer)).statusCode, 201);
    const versionAfterFirst = (await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar })).json().version;

    const dupName = await create({ ...validPeer, certSha256: FINGERPRINT_B });
    assert.strictEqual(dupName.statusCode, 409);
    assert.strictEqual(dupName.json().error.code, "PEER_NAME_CONFLICT");
    const dupCert = await create({ ...validPeer, name: "Other Name" });
    assert.strictEqual(dupCert.statusCode, 409);
    assert.strictEqual(dupCert.json().error.code, "PEER_CERT_CONFLICT");

    const versionAfter = (await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar })).json().version;
    assert.strictEqual(versionAfter, versionAfterFirst, "a failed registration must roll back its config version");
    const audited = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=peer.create", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(audited.length, 1, "and its audit entry");
  });

  it("updates profile and enabled state, versioning only enforcement-relevant changes", async () => {
    const peer = (await create({ ...validPeer, profile: "classical-allowed" })).json();
    const v0 = (await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar })).json().version;

    const descOnly = await t.app.inject({ method: "PATCH", url: `/v1/peers/${peer.id}`, headers: t.bearer(admin), payload: { description: "legacy partner" } });
    assert.strictEqual(descOnly.statusCode, 200);
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar })).json().version, v0);

    const tightened = await t.app.inject({ method: "PATCH", url: `/v1/peers/${peer.id}`, headers: t.bearer(admin), payload: { profile: "hybrid-required" } });
    assert.strictEqual(tightened.json().profile, "hybrid-required");
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar })).json().version, v0 + 1);

    const disabled = await t.app.inject({ method: "PATCH", url: `/v1/peers/${peer.id}`, headers: t.bearer(admin), payload: { enabled: false } });
    assert.strictEqual(disabled.json().enabled, false);
    const [change] = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=peer.update&limit=1", headers: t.bearer(auditor) })).json().events;
    assert.deepStrictEqual(change.details.before, { profile: "hybrid-required", enabled: true });
    assert.deepStrictEqual(change.details.after, { profile: "hybrid-required", enabled: false });
  });

  it("rejects an empty update and an update of an unknown peer", async () => {
    const peer = (await create(validPeer)).json();
    assert.strictEqual((await t.app.inject({ method: "PATCH", url: `/v1/peers/${peer.id}`, headers: t.bearer(admin), payload: {} })).statusCode, 400);
    const missing = await t.app.inject({ method: "PATCH", url: "/v1/peers/00000000-0000-4000-8000-000000000000", headers: t.bearer(admin), payload: { enabled: false } });
    assert.strictEqual(missing.statusCode, 404);
    assert.strictEqual((await t.app.inject({ method: "PATCH", url: "/v1/peers/not-a-uuid", headers: t.bearer(admin), payload: { enabled: false } })).statusCode, 400);
  });

  it("deletes a peer and records it", async () => {
    const peer = (await create(validPeer)).json();
    const res = await t.app.inject({ method: "DELETE", url: `/v1/peers/${peer.id}`, headers: t.bearer(admin) });
    assert.strictEqual(res.statusCode, 204);
    assert.deepStrictEqual((await t.app.inject({ method: "GET", url: "/v1/peers", headers: t.bearer(admin) })).json(), []);
    assert.strictEqual((await t.app.inject({ method: "DELETE", url: `/v1/peers/${peer.id}`, headers: t.bearer(admin) })).statusCode, 404);
    const audited = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=peer.delete", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(audited[0].details.certSha256, FINGERPRINT_A);
  });

  it("lets auditors read but never change the registry", async () => {
    const peer = (await create(validPeer)).json();
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/peers", headers: t.bearer(auditor) })).statusCode, 200);
    assert.strictEqual((await create({ ...validPeer, name: "Second Peer", certSha256: FINGERPRINT_B }, auditor)).statusCode, 403);
    assert.strictEqual((await t.app.inject({ method: "PATCH", url: `/v1/peers/${peer.id}`, headers: t.bearer(auditor), payload: { enabled: false } })).statusCode, 403);
    assert.strictEqual((await t.app.inject({ method: "DELETE", url: `/v1/peers/${peer.id}`, headers: t.bearer(auditor) })).statusCode, 403);
  });
});
