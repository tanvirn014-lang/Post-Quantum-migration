import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { buildServer } from "../../src/http/server.js";
import { TEST_PASSWORD, createTestApp } from "../helpers/test-app.js";

/** Proposal T-02 / T-04: key material and credentials must be absent from application logs. */
describe("log hygiene: credentials and tokens never reach the application log", () => {
  it("keeps passwords, access tokens, refresh tokens and partner assertions out of the log across auth, API and error paths", async () => {
    const t = await createTestApp();
    const customer = await t.customer();

    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString("utf8"));
        done();
      },
    });
    const app = buildServer(t.deps, { logger: true, logStream: sink });

    const wrongPassword = "wrong-password-canary-8841";
    const forgedAssertion = "forged-assertion-canary.8842";

    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: customer.user.email, password: TEST_PASSWORD } });
    assert.strictEqual(login.statusCode, 200);
    const accessToken = login.json().accessToken as string;
    const refreshCookie = login.cookies.find((c) => c.name === "pq_refresh")!.value;

    await app.inject({ method: "POST", url: "/auth/login", payload: { email: customer.user.email, password: wrongPassword } });
    await app.inject({ method: "GET", url: "/accounts", headers: { authorization: `Bearer ${accessToken}` } });
    await app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: refreshCookie } });
    await app.inject({ method: "POST", url: "/auth/login", payload: "{not json", headers: { "content-type": "application/json" } });
    await app.inject({
      method: "POST",
      url: "/partner/v1/payments",
      headers: { "x-sidecar-assertion": forgedAssertion, "idempotency-key": "log-hygiene-0001" },
      payload: { toAccountId: "x", amountMinorUnits: "1", currency: "BDT", reference: "r" },
    });
    await app.close();

    const log = lines.join("");
    assert.match(log, /"msg":"request completed"/, "the logger really recorded the requests (otherwise this test proves nothing)");
    assert.match(log, /"url":"\/auth\/login"/);

    const secrets = { password: TEST_PASSWORD, wrongPassword, accessToken, refreshCookie, forgedAssertion };
    for (const [name, value] of Object.entries(secrets)) {
      assert.ok(!log.includes(value), `${name} appears in the application log`);
    }
    assert.ok(!/authorization/i.test(log) || !log.includes("Bearer "), "no bearer header value in the log");
  });
});
