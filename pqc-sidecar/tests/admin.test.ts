import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adminResponse } from "../src/admin.js";

const statusBody = () => ({ detail: true });

describe("sidecar admin endpoints", () => {
  it("healthz reflects readiness but is always 200", () => {
    assert.deepEqual(adminResponse("/healthz", { ready: true }, statusBody), { statusCode: 200, body: { status: "ok" } });
    assert.deepEqual(adminResponse("/healthz", { ready: false }, statusBody), { statusCode: 200, body: { status: "starting" } });
  });

  it("livez is always alive", () => {
    assert.deepEqual(adminResponse("/livez", { ready: false }, statusBody), { statusCode: 200, body: { status: "alive" } });
  });

  it("readyz is 503 until a configuration is applied, then 200", () => {
    assert.equal(adminResponse("/readyz", { ready: false }, statusBody).statusCode, 503);
    assert.equal(adminResponse("/readyz", { ready: true }, statusBody).statusCode, 200);
  });

  it("status returns the full status body; unknown routes are 404", () => {
    assert.deepEqual(adminResponse("/status", { ready: true }, statusBody), { statusCode: 200, body: { detail: true } });
    assert.equal(adminResponse("/nope", { ready: true }, statusBody).statusCode, 404);
  });
});
