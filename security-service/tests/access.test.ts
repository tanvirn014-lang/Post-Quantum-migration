import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, importPKCS8 } from "jose";
import { generateKeyPairSync } from "node:crypto";
import type pg from "pg";
import { ROLES, type Role } from "../src/auth/permissions.js";
import { AUDIENCE, ISSUER, createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

const staffRoutes: { method: "GET" | "POST"; url: string; allowed: Role[]; payload?: object }[] = [
  { method: "GET", url: "/v1/overview", allowed: ["security_admin", "auditor"] },
  { method: "GET", url: "/v1/status/components", allowed: ["security_admin", "auditor"] },
  { method: "GET", url: "/v1/peers", allowed: ["security_admin", "auditor"] },
  { method: "GET", url: "/v1/crypto/config", allowed: ["security_admin", "auditor"] },
  { method: "GET", url: "/v1/crypto/profiles", allowed: ["security_admin", "auditor"] },
  { method: "GET", url: "/v1/telemetry/connections", allowed: ["security_admin", "auditor"] },
  { method: "GET", url: "/v1/telemetry/summary", allowed: ["security_admin", "auditor"] },
  { method: "GET", url: "/v1/audit/events", allowed: ["security_admin", "auditor"] },
  { method: "GET", url: "/v1/audit/verify", allowed: ["security_admin", "auditor"] },
  { method: "POST", url: "/v1/peers", allowed: ["security_admin"], payload: { name: "Matrix Peer", certSha256: "e".repeat(64), profile: "hybrid-required" } },
  { method: "POST", url: "/v1/crypto/config/active", allowed: ["security_admin"], payload: { profile: "hybrid-only" } },
];

describe("access control", () => {
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

  for (const route of staffRoutes) {
    it(`${route.method} ${route.url}: only ${route.allowed.join(", ")} are allowed`, async () => {
      for (const role of ROLES) {
        // Fresh state per role so a successful config change by one role cannot mask another.
        await resetDatabase(pool);
        const res = await t.app.inject({
          method: route.method,
          url: route.url,
          headers: t.bearer(await t.token(role)),
          ...(route.payload ? { payload: route.payload } : {}),
        });
        const reached = res.statusCode !== 401 && res.statusCode !== 403;
        assert.strictEqual(reached, route.allowed.includes(role), `${role} got ${res.statusCode}: ${res.body}`);
      }
    });
  }

  it("denies customers and operators everything staff-facing", async () => {
    for (const role of ["customer", "operator"] as const) {
      const res = await t.app.inject({ method: "GET", url: "/v1/overview", headers: t.bearer(await t.token(role)) });
      assert.strictEqual(res.statusCode, 403, role);
      assert.strictEqual(res.json().error.code, "FORBIDDEN");
    }
  });

  describe("access tokens", () => {
    it("requires a token", async () => {
      const res = await t.app.inject({ method: "GET", url: "/v1/overview" });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json().error.code, "AUTH_REQUIRED");
    });

    it("rejects expired tokens, tokens from another issuer or key, and garbage", async () => {
      const expired = await t.token("security_admin", { expiresIn: "-1m" });
      assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/overview", headers: t.bearer(expired) })).statusCode, 401);

      const otherKey = await importPKCS8(generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "EdDSA");
      const forged = await new SignJWT({ role: "security_admin" })
        .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
        .setSubject("attacker")
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setExpirationTime("10m")
        .sign(otherKey);
      assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/overview", headers: t.bearer(forged) })).statusCode, 401);

      assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/overview", headers: t.bearer("not.a.jwt") })).statusCode, 401);
    });

    it("rejects a token with an unknown role claim", async () => {
      const token = await t.token("auditor");
      const [h, , s] = token.split(".");
      const payload = Buffer.from(JSON.stringify({ sub: "x", role: "root", iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
      assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/overview", headers: t.bearer(`${h}.${payload}.${s}`) })).statusCode, 401);
    });
  });

  describe("service tokens", () => {
    it("protects the internal APIs: no token, wrong token and a staff JWT are all rejected", async () => {
      const paths = ["/internal/v1/sidecar-config"];
      for (const url of paths) {
        assert.strictEqual((await t.app.inject({ method: "GET", url })).statusCode, 401);
        assert.strictEqual((await t.app.inject({ method: "GET", url, headers: { authorization: "Bearer wrong-token" } })).statusCode, 401);
        assert.strictEqual((await t.app.inject({ method: "GET", url, headers: t.bearer(await t.token("security_admin")) })).statusCode, 401);
      }
      const post = await t.app.inject({ method: "POST", url: "/internal/v1/events/connections", headers: { authorization: "Bearer nope" }, payload: { events: [] } });
      assert.strictEqual(post.statusCode, 401);
      assert.strictEqual(post.json().error.code, "INVALID_SERVICE_TOKEN");
    });

    it("does not let the sidecar token reach staff APIs", async () => {
      const res = await t.app.inject({ method: "GET", url: "/v1/peers", headers: t.sidecar });
      assert.strictEqual(res.statusCode, 401);
    });
  });

  it("answers health and readiness without authentication and sends hardening headers", async () => {
    const health = await t.app.inject({ method: "GET", url: "/healthz" });
    assert.strictEqual(health.statusCode, 200);
    assert.strictEqual(health.headers["x-content-type-options"], "nosniff");
    assert.ok(health.headers["x-request-id"]);
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/readyz" })).statusCode, 200);
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/livez" })).json().status, "alive");
    const metrics = await t.app.inject({ method: "GET", url: "/metrics" });
    assert.strictEqual(metrics.statusCode, 200);
    assert.match(metrics.body, /http_requests_total/);
  });

  it("returns a consistent error envelope for unknown routes and bad JSON", async () => {
    const missing = await t.app.inject({ method: "GET", url: "/v1/nope" });
    assert.strictEqual(missing.statusCode, 404);
    assert.strictEqual(missing.json().error.code, "NOT_FOUND");
    const bad = await t.app.inject({ method: "POST", url: "/v1/peers", headers: { ...t.bearer(await t.token("security_admin")), "content-type": "application/json" }, payload: "{oops" });
    assert.strictEqual(bad.statusCode, 400);
    assert.strictEqual(bad.json().error.code, "BAD_REQUEST");
  });

  it("restricts CORS to the configured origins", async () => {
    const ok = await t.app.inject({ method: "GET", url: "/healthz", headers: { origin: "http://localhost:3100" } });
    assert.strictEqual(ok.headers["access-control-allow-origin"], "http://localhost:3100");
    const bad = await t.app.inject({ method: "GET", url: "/healthz", headers: { origin: "https://evil.example" } });
    assert.strictEqual(bad.headers["access-control-allow-origin"], undefined);
  });
});
