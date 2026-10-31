import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { BENCH_TOKEN, SIDECAR_TOKEN, createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

const benchPayload = (overrides: Record<string, unknown> = {}) => ({
  runId: "2026-11-01T10-00-00-000Z-quick",
  label: "unit test run",
  manifest: { runId: "2026-11-01T10-00-00-000Z-quick", sourceRevision: { commit: "abc1234", workingTreeDirty: false }, host: { cpuModel: "Test CPU", logicalCores: 8 }, caveats: ["loopback only"] },
  summary: {
    latency: { classical: { latencyMs: { median: 1.2 } }, hybrid: { latencyMs: { median: 1.5 } }, h2Verdict: "inconclusive" },
    throughput: [{ concurrency: 1, condition: "classical", handshakesPerSecondMedian: 500 }],
  },
  handshakesCsv: "run,condition\n0,classical\n0,hybrid\n",
  throughputCsv: "concurrency,condition\n1,classical\n",
  ...overrides,
});

describe("HNDL simulator API", () => {
  let pool: pg.Pool;
  let t: TestApp;
  before(async () => {
    pool = await setupPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    t = await createTestApp(pool);
  });
  after(async () => {
    await pool.end();
  });

  it("runs the simulation for an auditor, labels it a simulation, stores it and audits it", async () => {
    const headers = t.bearer(await t.token("auditor"));
    const res = await t.app.inject({ method: "POST", url: "/v1/hndl/run", headers, payload: { message: "pay 500", quantumAssumption: "x25519-broken" } });
    assert.strictEqual(res.statusCode, 201, res.body);
    const body = res.json();
    assert.strictEqual(body.label, "SIMULATION");
    assert.strictEqual(body.sessions.classical.recovered, true);
    assert.strictEqual(body.sessions.hybrid.recovered, false);
    assert.ok(body.id && body.createdAt);

    const list = await t.app.inject({ method: "GET", url: "/v1/hndl/runs", headers });
    assert.strictEqual(list.statusCode, 200);
    assert.strictEqual(list.json().length, 1);
    assert.strictEqual(list.json()[0].id, body.id);

    const audited = await pool.query("SELECT action, outcome, details FROM audit_events WHERE action = 'hndl.run'");
    assert.strictEqual(audited.rowCount, 1);
    assert.doesNotMatch(JSON.stringify(audited.rows[0].details), /pay 500/, "the toy message is not copied into the audit log");
  });

  it("validates input", async () => {
    const headers = t.bearer(await t.token("security_admin"));
    for (const payload of [{}, { message: "", quantumAssumption: "none" }, { message: "x", quantumAssumption: "magic" }, { message: "x".repeat(300), quantumAssumption: "none" }]) {
      const res = await t.app.inject({ method: "POST", url: "/v1/hndl/run", headers, payload });
      assert.strictEqual(res.statusCode, 400, JSON.stringify(payload));
      assert.strictEqual(res.json().error.code, "VALIDATION_ERROR");
    }
  });

  it("denies customers and operators", async () => {
    for (const role of ["customer", "operator"] as const) {
      const res = await t.app.inject({ method: "POST", url: "/v1/hndl/run", headers: t.bearer(await t.token(role)), payload: { message: "x", quantumAssumption: "none" } });
      assert.strictEqual(res.statusCode, 403, role);
    }
  });

  it("computes the Mosca assessment and rejects invalid years", async () => {
    const headers = t.bearer(await t.token("auditor"));
    const ok = await t.app.inject({ method: "POST", url: "/v1/hndl/mosca", headers, payload: { shelfLifeYears: 10, migrationYears: 5, yearsToQuantum: 12 } });
    assert.strictEqual(ok.statusCode, 200);
    assert.strictEqual(ok.json().atRisk, true);
    const bad = await t.app.inject({ method: "POST", url: "/v1/hndl/mosca", headers, payload: { shelfLifeYears: -1, migrationYears: 5, yearsToQuantum: 12 } });
    assert.strictEqual(bad.statusCode, 400);
  });
});

describe("benchmark ingestion and read API", () => {
  let pool: pg.Pool;
  let t: TestApp;
  before(async () => {
    pool = await setupPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    t = await createTestApp(pool);
  });
  after(async () => {
    await pool.end();
  });

  const ingest = (payload: unknown, token: string | null = BENCH_TOKEN) =>
    t.app.inject({ method: "POST", url: "/internal/v1/benchmarks", headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as object });

  it("accepts a run with the bench token, stores raw CSVs with checksums and audits the ingestion", async () => {
    const res = await ingest(benchPayload());
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.strictEqual(res.json().runId, "2026-11-01T10-00-00-000Z-quick");

    const headers = t.bearer(await t.token("auditor"));
    const list = await t.app.inject({ method: "GET", url: "/v1/benchmarks", headers });
    assert.strictEqual(list.statusCode, 200);
    assert.strictEqual(list.json().length, 1);
    assert.strictEqual(list.json()[0].commit, "abc1234");
    assert.strictEqual(list.json()[0].csv.handshakes.bytes, benchPayload().handshakesCsv.length);
    assert.match(list.json()[0].csv.handshakes.sha256, /^[0-9a-f]{64}$/);
    assert.strictEqual(list.json()[0].summary, undefined, "the list is a light index");

    const one = await t.app.inject({ method: "GET", url: `/v1/benchmarks/${encodeURIComponent("2026-11-01T10-00-00-000Z-quick")}`, headers });
    assert.strictEqual(one.statusCode, 200);
    assert.strictEqual(one.json().summary.latency.h2Verdict, "inconclusive");
    assert.deepStrictEqual(one.json().manifest.caveats, ["loopback only"]);

    const csv = await t.app.inject({ method: "GET", url: `/v1/benchmarks/${encodeURIComponent("2026-11-01T10-00-00-000Z-quick")}/handshakes.csv`, headers });
    assert.strictEqual(csv.statusCode, 200);
    assert.match(String(csv.headers["content-type"]), /text\/csv/);
    assert.strictEqual(csv.body, benchPayload().handshakesCsv, "the raw CSV is returned byte for byte");

    const audited = await pool.query("SELECT actor_role, details FROM audit_events WHERE action = 'benchmark.ingest'");
    assert.strictEqual(audited.rowCount, 1);
    assert.strictEqual(audited.rows[0].actor_role, null);
  });

  it("rejects missing, wrong and other principals' tokens", async () => {
    assert.strictEqual((await ingest(benchPayload(), null)).statusCode, 401);
    assert.strictEqual((await ingest(benchPayload(), "wrong-token-wrong-token-wrong-token-wrong")).statusCode, 401);
    assert.strictEqual((await ingest(benchPayload(), SIDECAR_TOKEN)).statusCode, 401, "the sidecar token grants nothing here");
    const staff = await t.app.inject({ method: "POST", url: "/internal/v1/benchmarks", headers: t.bearer(await t.token("security_admin")), payload: benchPayload() });
    assert.strictEqual(staff.statusCode, 401, "a staff access token is not a service token");
  });

  it("is not available when no bench token is configured", async () => {
    const noBench = await createTestApp(pool, { benchToken: undefined });
    const res = await noBench.app.inject({ method: "POST", url: "/internal/v1/benchmarks", headers: { authorization: `Bearer ${BENCH_TOKEN}` }, payload: benchPayload() });
    assert.strictEqual(res.statusCode, 401);
  });

  it("refuses to overwrite an existing run (evidence is immutable)", async () => {
    assert.strictEqual((await ingest(benchPayload())).statusCode, 201);
    const again = await ingest(benchPayload({ label: "tampered" }));
    assert.strictEqual(again.statusCode, 409);
    const headers = t.bearer(await t.token("auditor"));
    const one = await t.app.inject({ method: "GET", url: `/v1/benchmarks/${encodeURIComponent("2026-11-01T10-00-00-000Z-quick")}`, headers });
    assert.strictEqual(one.json().label, "unit test run");
  });

  it("validates the payload shape and run id", async () => {
    assert.strictEqual((await ingest(benchPayload({ runId: "../etc/passwd" }))).statusCode, 400);
    assert.strictEqual((await ingest({ ...benchPayload(), summary: undefined })).statusCode, 400);
    assert.strictEqual((await ingest(benchPayload({ handshakesCsv: 42 }))).statusCode, 400);
  });

  it("flags a run with failed handshakes as invalid in both the list and the detail view, and never as valid", async () => {
    const failing = (failed: number, attempted = 1000) => ({ attempted, succeeded: attempted - failed, failed, latencyMs: { median: 1 } });
    const summaryOf = (classical: object, hybrid: object, throughputFailures = 0) => ({ latency: { classical, hybrid }, throughput: [{ concurrency: 1, condition: "hybrid", failures: throughputFailures }] });
    await ingest(benchPayload({ runId: "run-clean-0001", summary: summaryOf(failing(0), failing(0)) }));
    await ingest(benchPayload({ runId: "run-fails-0001", summary: summaryOf(failing(0), failing(240)) }));
    await ingest(benchPayload({ runId: "run-thru-fail1", summary: summaryOf(failing(0), failing(0), 3) }));
    await ingest(benchPayload({ runId: "run-nodata-001", summary: { latency: {}, throughput: [] } }));

    const headers = t.bearer(await t.token("auditor"));
    const list = (await t.app.inject({ method: "GET", url: "/v1/benchmarks", headers })).json() as { runId: string; integrity: { status: string; problems: string[] } }[];
    const by = Object.fromEntries(list.map((r) => [r.runId, r.integrity]));
    assert.strictEqual(by["run-clean-0001"]!.status, "valid");
    assert.strictEqual(by["run-fails-0001"]!.status, "invalid");
    assert.match(by["run-fails-0001"]!.problems.join(" "), /hybrid: 240 of 1000/);
    assert.strictEqual(by["run-thru-fail1"]!.status, "invalid");
    assert.strictEqual(by["run-nodata-001"]!.status, "unverifiable");

    const one = (await t.app.inject({ method: "GET", url: "/v1/benchmarks/run-fails-0001", headers })).json();
    assert.strictEqual(one.integrity.status, "invalid");
  });

  it("accepts a payload larger than the default body limit", async () => {
    const big = "run,condition\n" + "0,classical\n".repeat(80_000); // ~1 MB
    const res = await ingest(benchPayload({ runId: "big-run-0001", handshakesCsv: big }));
    assert.strictEqual(res.statusCode, 201, res.body.slice(0, 200));
  });

  it("returns 404 for an unknown run and denies customers and operators the read API", async () => {
    const headers = t.bearer(await t.token("auditor"));
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/benchmarks/unknown-run-id", headers })).statusCode, 404);
    for (const role of ["customer", "operator"] as const) {
      assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/benchmarks", headers: t.bearer(await t.token(role)) })).statusCode, 403, role);
    }
  });
});
