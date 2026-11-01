import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import type pg from "pg";
import { buildServer } from "../src/http/server.js";
import { BENCH_TOKEN, SIDECAR_TOKEN, createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

/** Proposal T-02 / T-04: tokens, service secrets and user-supplied payloads must be absent from application logs. */
describe("log hygiene: secrets never reach the application log", () => {
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

  it("keeps access tokens, service tokens and request payloads out of the log across staff, sidecar, benchmark and error paths", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString("utf8"));
        done();
      },
    });
    const app = buildServer(t.deps, { logger: true, logStream: sink });

    const admin = await t.token("security_admin");
    const auditor = await t.token("auditor");
    const toyMessage = "hndl-toy-message-canary-7731";
    const csvCanary = "csv-canary-7732";

    await app.inject({ method: "GET", url: "/v1/overview", headers: t.bearer(admin) });
    await app.inject({ method: "POST", url: "/v1/hndl/run", headers: t.bearer(auditor), payload: { message: toyMessage, quantumAssumption: "x25519-broken" } });
    await app.inject({ method: "GET", url: "/internal/v1/sidecar-config", headers: { authorization: `Bearer ${SIDECAR_TOKEN}` } });
    await app.inject({
      method: "POST",
      url: "/internal/v1/benchmarks",
      headers: { authorization: `Bearer ${BENCH_TOKEN}` },
      payload: { runId: "log-hygiene-run-1", label: "l", manifest: {}, summary: {}, handshakesCsv: `a\n${csvCanary}\n`, throughputCsv: "b\n" },
    });
    await app.inject({ method: "GET", url: "/v1/overview", headers: { authorization: "Bearer not-a-real-token-canary-7733" } });
    await app.inject({ method: "POST", url: "/internal/v1/benchmarks", headers: { authorization: "Bearer wrong-service-token-canary-7734" }, payload: {} });
    await app.close();

    const log = lines.join("");
    assert.match(log, /"msg":"request completed"/, "the logger really recorded the requests (otherwise this test proves nothing)");
    assert.match(log, /"url":"\/v1\/overview"/);

    const secrets = { adminToken: admin, auditorToken: auditor, sidecarToken: SIDECAR_TOKEN, benchToken: BENCH_TOKEN, toyMessage, csvCanary, badToken: "not-a-real-token-canary-7733", wrongServiceToken: "wrong-service-token-canary-7734" };
    for (const [name, value] of Object.entries(secrets)) {
      assert.ok(!log.includes(value), `${name} appears in the application log`);
    }
  });
});
