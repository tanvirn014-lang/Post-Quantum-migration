import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, type TestApp } from "../helpers/test-app.js";

describe("observability endpoints", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.app.close();
  });

  it("exposes health, liveness and readiness without authentication", async () => {
    t = await createTestApp({});
    assert.equal((await t.app.inject({ method: "GET", url: "/healthz" })).statusCode, 200);
    assert.equal((await t.app.inject({ method: "GET", url: "/livez" })).json().status, "alive");
    const ready = await t.app.inject({ method: "GET", url: "/readyz" });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().status, "ready");
  });

  it("reports 503 from readiness when the backing store is unreachable", async () => {
    t = await createTestApp({});
    (t.deps as { ping?: () => Promise<void> }).ping = async () => {
      throw new Error("db down");
    };
    const res = await t.app.inject({ method: "GET", url: "/readyz" });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().status, "not-ready");
  });

  it("serves Prometheus metrics that count handled requests", async () => {
    t = await createTestApp({});
    await t.app.inject({ method: "GET", url: "/healthz" });
    const res = await t.app.inject({ method: "GET", url: "/metrics" });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] ?? "", /text\/plain/);
    assert.match(res.body, /http_requests_total\{method="GET",status="200"\}/);
  });
});
