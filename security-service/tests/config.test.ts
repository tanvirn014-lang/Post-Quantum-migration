import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

describe("crypto agility: provider registry and TLS profile configuration", () => {
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

  const get = (url: string, token = admin) => t.app.inject({ method: "GET", url, headers: t.bearer(token) });
  const setActive = (profile: string, token = admin, note?: string) =>
    t.app.inject({ method: "POST", url: "/v1/crypto/config/active", headers: t.bearer(token), payload: { profile, ...(note ? { note } : {}) } });

  it("ships three built-in profiles and starts on hybrid-preferred", async () => {
    const profiles = (await get("/v1/crypto/profiles")).json();
    assert.deepStrictEqual(profiles.map((p: { name: string }) => p.name).sort(), ["classical-baseline", "hybrid-only", "hybrid-preferred"]);
    const config = (await get("/v1/crypto/config")).json();
    assert.strictEqual(config.activeProfile.name, "hybrid-preferred");
    assert.deepStrictEqual(config.activeProfile.groups, ["X25519MLKEM768", "X25519"]);
  });

  it("describes what each profile can and cannot protect, without overclaiming", async () => {
    const byName = Object.fromEntries((await get("/v1/crypto/profiles")).json().map((p: { name: string }) => [p.name, p]));
    assert.strictEqual(byName["classical-baseline"].offersHybrid, false);
    assert.match(byName["classical-baseline"].summary, /no post-quantum/i);
    assert.strictEqual(byName["hybrid-preferred"].allowsClassical, true);
    assert.match(byName["hybrid-preferred"].summary, /no post-quantum key-establishment protection/i);
    assert.strictEqual(byName["hybrid-only"].allowsClassical, false);
    for (const p of Object.values(byName) as { summary: string }[]) assert.doesNotMatch(p.summary, /quantum-(proof|safe|resistant)/i);
  });

  it("lists the BCJSSE provider as PLANNED and not selectable", async () => {
    const providers = (await get("/v1/crypto/providers")).json();
    const node = providers.find((p: { id: string }) => p.id === "node-openssl");
    const bc = providers.find((p: { id: string }) => p.id === "bcjsse-java");
    assert.strictEqual(node.status, "LIVE");
    assert.strictEqual(node.selectable, true);
    assert.strictEqual(bc.status, "PLANNED");
    assert.strictEqual(bc.selectable, false);
    assert.deepStrictEqual(bc.supportedGroups, []);
  });

  it("switches the active profile: new version, audit entry, sidecar sees it", async () => {
    const v0 = (await get("/v1/crypto/config")).json().version;
    const res = await setActive("hybrid-only", admin, "tighten for experiment E");
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().version, v0 + 1);

    const sidecarView = (await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar })).json();
    assert.strictEqual(sidecarView.version, v0 + 1);
    assert.strictEqual(sidecarView.tlsProfile.name, "hybrid-only");
    assert.deepStrictEqual(sidecarView.tlsProfile.groups, ["X25519MLKEM768"]);

    const [event] = (await get("/v1/audit/events?action=config.tls_profile.set", auditor)).json().events;
    assert.deepStrictEqual([event.details.from, event.details.to, event.details.note], ["hybrid-preferred", "hybrid-only", "tighten for experiment E"]);
    assert.strictEqual(event.details.configVersion, v0 + 1);
  });

  it("refuses an unknown profile (404) and re-selecting the active one (409), changing nothing", async () => {
    const v0 = (await get("/v1/crypto/config")).json().version;
    assert.strictEqual((await setActive("does-not-exist")).statusCode, 404);
    const same = await setActive("hybrid-preferred");
    assert.strictEqual(same.statusCode, 409);
    assert.strictEqual(same.json().error.code, "PROFILE_ALREADY_ACTIVE");
    assert.strictEqual((await get("/v1/crypto/config")).json().version, v0);
    assert.strictEqual((await get("/v1/audit/events?action=config.tls_profile.set", auditor)).json().events.length, 0);
  });

  it("only security admins may change configuration; auditors may read it", async () => {
    assert.strictEqual((await setActive("hybrid-only", auditor)).statusCode, 403);
    assert.strictEqual((await get("/v1/crypto/config", auditor)).statusCode, 200);
    const denied = (await get("/v1/audit/events?action=authz.denied", auditor)).json().events;
    assert.strictEqual(denied.length, 1);
    assert.strictEqual(denied[0].details.permission, "config:manage");
  });

  describe("custom profiles", () => {
    const create = (body: object, token = admin) => t.app.inject({ method: "POST", url: "/v1/crypto/profiles", headers: t.bearer(token), payload: body });

    it("accepts a profile built only from registered, provider-supported groups", async () => {
      const res = await create({ name: "classical-then-hybrid", description: "Experiment ordering", groups: ["X25519", "X25519MLKEM768"] });
      assert.strictEqual(res.statusCode, 201, res.body);
      assert.deepStrictEqual(res.json().groups, ["X25519", "X25519MLKEM768"]);
      assert.strictEqual((await setActive("classical-then-hybrid")).statusCode, 200);
    });

    it("rejects unregistered groups, duplicates, empty lists and bad names", async () => {
      for (const bad of [
        { name: "ok-name", description: "d", groups: ["MadeUpGroup"] },
        { name: "ok-name", description: "d", groups: ["X25519", "X25519"] },
        { name: "ok-name", description: "d", groups: [] },
        { name: "Bad Name!", description: "d", groups: ["X25519"] },
      ]) {
        const res = await create(bad);
        assert.strictEqual(res.statusCode, 400, JSON.stringify(bad));
      }
      assert.deepStrictEqual((await get("/v1/crypto/profiles")).json().length, 3);
    });

    it("rejects a duplicate name and forbids auditors", async () => {
      assert.strictEqual((await create({ name: "hybrid-only", description: "d", groups: ["X25519"] })).statusCode, 409);
      assert.strictEqual((await create({ name: "mine", description: "d", groups: ["X25519"] }, auditor)).statusCode, 403);
    });
  });

  describe("sidecar configuration API", () => {
    it("supports conditional GET on the version ETag", async () => {
      const first = await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: t.sidecar });
      const etag = String(first.headers["etag"]);
      assert.match(etag, /^"v\d+"$/);
      const notModified = await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: { ...t.sidecar, "if-none-match": etag } });
      assert.strictEqual(notModified.statusCode, 304);
      await setActive("hybrid-only");
      const changed = await t.app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: { ...t.sidecar, "if-none-match": etag } });
      assert.strictEqual(changed.statusCode, 200);
      assert.notStrictEqual(changed.headers["etag"], etag);
    });

    it("reports time-to-apply once a sidecar heartbeat shows the new version applied (experiment E)", async () => {
      const startedAt = new Date().toISOString();
      const hb = (version: number, profile: string) =>
        t.app.inject({
          method: "POST",
          url: "/internal/v1/sidecar/heartbeat",
          headers: t.sidecar,
          payload: { instanceId: "sidecar-test", startedAt, appliedConfigVersion: version, activeProfile: profile, runtime: { openssl: "3.5.7" } },
        });
      const v0 = (await get("/v1/crypto/config")).json().version;
      assert.strictEqual((await hb(v0, "hybrid-preferred")).statusCode, 204);

      const changed = (await setActive("hybrid-only")).json();
      let history = (await get("/v1/crypto/config")).json().history;
      assert.strictEqual(history[0].version, changed.version);
      assert.strictEqual(history[0].firstAppliedAt, null, "not applied yet");

      await new Promise((r) => setTimeout(r, 25));
      await hb(changed.version, "hybrid-only");
      history = (await get("/v1/crypto/config")).json().history;
      assert.ok(history[0].firstAppliedAt);
      assert.ok(history[0].timeToApplyMs >= 20, `time to apply was ${history[0].timeToApplyMs}`);

      const overview = (await get("/v1/overview")).json();
      assert.strictEqual(overview.sidecars[0].inSync, true);
      assert.strictEqual(overview.sidecars[0].stale, false);
      assert.strictEqual(overview.sidecars[0].runtime.openssl, "3.5.7");
    });

    it("flags a sidecar that has not applied the latest configuration", async () => {
      const v0 = (await get("/v1/crypto/config")).json().version;
      await t.app.inject({
        method: "POST",
        url: "/internal/v1/sidecar/heartbeat",
        headers: t.sidecar,
        payload: { instanceId: "sidecar-lag", startedAt: new Date().toISOString(), appliedConfigVersion: v0, activeProfile: "hybrid-preferred" },
      });
      await setActive("classical-baseline");
      const [sidecar] = (await get("/v1/overview")).json().sidecars;
      assert.strictEqual(sidecar.inSync, false);
    });
  });
});
