import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, type TestApp } from "../helpers/test-app.js";
import { loadConfig } from "../../src/config.js";

describe("CORS and security headers", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp({ corsOrigins: ["http://localhost:3100", "https://app.example.com"] });
  });

  it("allows an allow-listed origin and permits credentials", async () => {
    const res = await t.app.inject({ method: "GET", url: "/healthz", headers: { origin: "https://app.example.com" } });
    assert.strictEqual(res.headers["access-control-allow-origin"], "https://app.example.com");
    assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
  });

  it("does not echo an origin that is not on the allow-list", async () => {
    const res = await t.app.inject({ method: "GET", url: "/healthz", headers: { origin: "https://evil.example" } });
    assert.strictEqual(res.headers["access-control-allow-origin"], undefined);
  });

  it("answers a preflight for an allow-listed origin including the Idempotency-Key header", async () => {
    const res = await t.app.inject({
      method: "OPTIONS",
      url: "/transfers",
      headers: {
        origin: "http://localhost:3100",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,idempotency-key,content-type",
      },
    });
    assert.strictEqual(res.statusCode, 204);
    assert.match(String(res.headers["access-control-allow-headers"]), /idempotency-key/i);
  });

  it("sends hardening headers and a request id on every response", async () => {
    const res = await t.app.inject({ method: "GET", url: "/healthz" });
    assert.strictEqual(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["x-request-id"]);
    assert.strictEqual(res.headers["x-powered-by"], undefined);
  });

  it("echoes a well-formed caller request id and replaces a malformed one", async () => {
    const good = await t.app.inject({ method: "GET", url: "/healthz", headers: { "x-request-id": "trace-12345678" } });
    assert.strictEqual(good.headers["x-request-id"], "trace-12345678");
    const bad = await t.app.inject({ method: "GET", url: "/healthz", headers: { "x-request-id": "bad id\twith spaces" } });
    assert.notStrictEqual(bad.headers["x-request-id"], "bad id\twith spaces");
  });
});

describe("configuration validation", () => {
  it("refuses a wildcard CORS origin", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "test", CORS_ORIGIN: "*" }), /wildcard origins are not allowed/);
  });

  it("refuses the memory store and a missing signing key in production", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "production" }), (err: Error) => /memory store is not allowed/.test(err.message) && /signing key is required/.test(err.message));
  });

  it("requires DATABASE_URL for the postgres store", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "test", LEDGER_STORE: "postgres" }), /DATABASE_URL/);
  });

  it("parses a comma-separated origin list", () => {
    const c = loadConfig({ NODE_ENV: "test", CORS_ORIGIN: "http://a.test, http://b.test" });
    assert.deepStrictEqual(c.corsOrigins, ["http://a.test", "http://b.test"]);
  });
});
