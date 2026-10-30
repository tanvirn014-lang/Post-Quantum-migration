import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { LedgerService } from "../../src/app/ledger-service.js";
import { MemoryLedgerStore } from "../../src/adapters/memory/ledger-store.js";
import { buildServer } from "../../src/http/server.js";

function newApp(): FastifyInstance {
  return buildServer(new LedgerService(new MemoryLedgerStore()), { logger: false });
}

describe("CORS", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = buildServer(new LedgerService(new MemoryLedgerStore()), { logger: false });
  });

  it("sets Access-Control-Allow-Origin on a cross-origin GET", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "http://localhost:3100" } });
    assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:3100");
  });
});

describe("CORS_ORIGIN environment configuration", () => {
  const ORIGINAL = process.env["CORS_ORIGIN"];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env["CORS_ORIGIN"];
    else process.env["CORS_ORIGIN"] = ORIGINAL;
  });

  it("restricts Access-Control-Allow-Origin to the configured allow-list", async () => {
    process.env["CORS_ORIGIN"] = "https://app.example.com, https://admin.example.com";
    const app = newApp();

    const allowed = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "https://app.example.com" } });
    assert.strictEqual(allowed.headers["access-control-allow-origin"], "https://app.example.com");

    const denied = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "http://localhost:3100" } });
    assert.strictEqual(denied.headers["access-control-allow-origin"], undefined);
  });

  it("falls back to reflecting any origin when CORS_ORIGIN is unset", async () => {
    delete process.env["CORS_ORIGIN"];
    const app = newApp();

    const res = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "http://localhost:3100" } });
    assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:3100");
  });
});
