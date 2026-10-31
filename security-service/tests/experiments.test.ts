import http from "node:http";
import type net from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

const SIM_TOKEN = "test-peer-sim-token-0123456789abcdef012345678";

describe("experiment runner (peer simulator proxy)", () => {
  let pool: pg.Pool;
  let sim: http.Server;
  let simUrl: string;
  const calls: { method: string; url: string; auth: string | undefined; body?: string }[] = [];
  let t: TestApp;
  let admin: string;
  let auditor: string;

  before(async () => {
    pool = await setupPool();
    sim = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      calls.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
      if (req.headers.authorization !== `Bearer ${SIM_TOKEN}`) {
        res.writeHead(401).end("{}");
        return;
      }
      res.setHeader("content-type", "application/json");
      if (req.url === "/scenarios") res.end(JSON.stringify([{ id: "hybrid-peer-hybrid-required", title: "t", experiment: "B", description: "d", expected: "allowed-hybrid" }]));
      else if (req.url === "/scenarios/hybrid-peer-hybrid-required/run") res.end(JSON.stringify({ id: "hybrid-peer-hybrid-required", expected: "allowed-hybrid", observed: "allowed-hybrid", passed: true }));
      else if (req.url === "/scenarios/broken/run") res.end(JSON.stringify({ id: "broken", expected: "allowed-hybrid", observed: "rejected-violation", passed: false }));
      else res.writeHead(404).end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
    });
    await new Promise<void>((resolve) => sim.listen(0, "127.0.0.1", resolve));
    simUrl = `http://127.0.0.1:${(sim.address() as net.AddressInfo).port}`;
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    calls.length = 0;
    t = await createTestApp(pool, { peerSimUrl: simUrl, peerSimToken: SIM_TOKEN });
    admin = await t.token("security_admin");
    auditor = await t.token("auditor");
  });
  after(async () => {
    await new Promise<void>((resolve) => sim.close(() => resolve()));
    await pool.end();
  });

  const run = (scenarioId: string, token = admin) => t.app.inject({ method: "POST", url: "/v1/experiments/run", headers: t.bearer(token), payload: { scenarioId } });

  it("lists scenarios from the simulator, authenticating with the simulator token", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/experiments/scenarios", headers: t.bearer(auditor) });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json()[0].id, "hybrid-peer-hybrid-required");
    assert.strictEqual(calls[0]?.auth, `Bearer ${SIM_TOKEN}`);
  });

  it("runs a scenario for a security admin and writes an audit entry with expected vs observed", async () => {
    const res = await run("hybrid-peer-hybrid-required");
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(res.json().passed, true);
    const [event] = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=experiment.run", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(event.outcome, "success");
    assert.deepStrictEqual([event.details.expected, event.details.observed], ["allowed-hybrid", "allowed-hybrid"]);
  });

  it("audits a scenario whose observation did not match the expectation as a failure", async () => {
    await run("broken");
    const [event] = (await t.app.inject({ method: "GET", url: "/v1/audit/events?action=experiment.run", headers: t.bearer(auditor) })).json().events;
    assert.strictEqual(event.outcome, "failure");
  });

  it("forwards validated scenario parameters to the simulator and rejects anything else", async () => {
    const params = { toAccountId: "11111111-1111-4111-8111-111111111111", amountMinorUnits: "2500", reference: "e2e payment" };
    const ok = await t.app.inject({ method: "POST", url: "/v1/experiments/run", headers: t.bearer(admin), payload: { scenarioId: "hybrid-peer-hybrid-required", params } });
    assert.strictEqual(ok.statusCode, 200, ok.body);
    assert.deepStrictEqual(JSON.parse(calls.at(-1)?.body ?? "null"), params);

    calls.length = 0;
    for (const bad of [{ amountMinorUnits: "-5" }, { amountMinorUnits: "1.5" }, { toAccountId: "not-a-uuid" }, { reference: "x".repeat(101) }, { extra: "field" }]) {
      const res = await t.app.inject({ method: "POST", url: "/v1/experiments/run", headers: t.bearer(admin), payload: { scenarioId: "hybrid-peer-hybrid-required", params: bad } });
      assert.strictEqual(res.statusCode, 400, JSON.stringify(bad));
    }
    assert.strictEqual(calls.length, 0, "invalid parameters never reach the simulator");
  });

  it("forbids auditors from running experiments", async () => {
    assert.strictEqual((await run("hybrid-peer-hybrid-required", auditor)).statusCode, 403);
    assert.strictEqual(calls.length, 0, "the simulator was never contacted");
  });

  it("validates the scenario id before contacting the simulator, and maps an unknown scenario to 404", async () => {
    assert.strictEqual((await run("../../etc/passwd")).statusCode, 400);
    assert.strictEqual((await run("Bad Id")).statusCode, 400);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual((await run("no-such-scenario")).statusCode, 404);
  });

  it("reports 503 instead of inventing a result when the simulator is not configured or unreachable", async () => {
    const unconfigured = await createTestApp(pool, {});
    const res = await unconfigured.app.inject({ method: "POST", url: "/v1/experiments/run", headers: unconfigured.bearer(await unconfigured.token("security_admin")), payload: { scenarioId: "hybrid-peer-hybrid-required" } });
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.json().error.code, "DEPENDENCY_UNAVAILABLE");

    const unreachable = await createTestApp(pool, { peerSimUrl: "http://127.0.0.1:1", peerSimToken: SIM_TOKEN });
    const res2 = await unreachable.app.inject({ method: "POST", url: "/v1/experiments/run", headers: unreachable.bearer(await unreachable.token("security_admin")), payload: { scenarioId: "hybrid-peer-hybrid-required" } });
    assert.strictEqual(res2.statusCode, 503);
  });
});
