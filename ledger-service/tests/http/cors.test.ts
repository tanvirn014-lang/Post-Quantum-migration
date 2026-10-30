import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { LedgerService } from "../../src/app/ledger-service.js";
import { MemoryLedgerStore } from "../../src/adapters/memory/ledger-store.js";
import { buildServer } from "../../src/http/server.js";

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
