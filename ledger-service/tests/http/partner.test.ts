import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { signAssertion, verifyAssertion, type PeerAssertion } from "../../src/partner/assertion.js";
import { PARTNER_CUSTOMER_EMAIL } from "../../src/http/routes/partner.js";
import { createTestApp, type TestApp } from "../helpers/test-app.js";

const SECRET = "partner-test-secret-0123456789abcdef0123456789";

function assertionFor(method: string, url: string, overrides: Partial<PeerAssertion> = {}): PeerAssertion {
  return {
    v: 2,
    peerId: "peer-hybrid-bank",
    peerName: "Simulated Hybrid Bank",
    keyExchange: "hybrid",
    negotiatedGroup: "X25519MLKEM768",
    decision: "allowed-hybrid",
    correlationId: randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    method,
    path: url,
    ...overrides,
  };
}

describe("partner API (reachable only through the sidecar)", () => {
  let t: TestApp;
  let customerAccountId: string;
  let settlementAccountId: string;

  async function provision(app: TestApp) {
    const operator = await app.staff("operator");
    const partnerCustomer = await app.stores.identity.createCustomer({ fullName: "Partner Network (system)", email: PARTNER_CUSTOMER_EMAIL });
    const settlement = await app.deps.ledger.createAccount({ ownerCustomerId: partnerCustomer.id, currency: "BDT", allowOverdraft: true, kind: "settlement" });
    const customer = await app.customer("Receiver");
    const account = (
      await app.app.inject({ method: "POST", url: "/accounts", headers: app.bearer(operator.token), payload: { ownerCustomerId: customer.customer.id, currency: "BDT" } })
    ).json();
    return { settlementAccountId: settlement.id, customerAccountId: account.id as string, customerToken: customer.token };
  }

  let customerToken: string;
  beforeEach(async () => {
    t = await createTestApp({ sidecarAssertionSecret: SECRET });
    ({ settlementAccountId, customerAccountId, customerToken } = await provision(t));
  });

  const post = (body: unknown, opts: { key?: string; assertion?: PeerAssertion | string | null; url?: string } = {}) => {
    const url = opts.url ?? "/partner/v1/payments";
    const assertion = opts.assertion === undefined ? assertionFor("POST", url) : opts.assertion;
    return t.app.inject({
      method: "POST",
      url,
      headers: {
        "idempotency-key": opts.key ?? randomUUID(),
        ...(assertion === null ? {} : { "x-sidecar-assertion": typeof assertion === "string" ? assertion : signAssertion(assertion, SECRET) }),
      },
      payload: body as object,
    });
  };
  const payment = (overrides: Record<string, unknown> = {}) => ({ toAccountId: customerAccountId, amountMinorUnits: "12500", currency: "BDT", reference: "Invoice 42", ...overrides });
  const balance = async () => (await t.app.inject({ method: "GET", url: `/accounts/${customerAccountId}`, headers: t.bearer(customerToken) })).json().balanceMinorUnits;

  it("credits the customer from the partner settlement account and records the verified TLS facts atomically", async () => {
    const res = await post(payment());
    assert.strictEqual(res.statusCode, 201, res.body);
    const tx = res.json();
    assert.strictEqual(tx.description, "Partner payment: Invoice 42");
    assert.strictEqual(tx.metadata.context.channel, "partner");
    assert.strictEqual(tx.metadata.context.peer.name, "Simulated Hybrid Bank");
    assert.deepStrictEqual(tx.metadata.context.tls, { keyExchange: "hybrid", negotiatedGroup: "X25519MLKEM768", decision: "allowed-hybrid" });
    assert.strictEqual(await balance(), "12500");
    const settlement = await t.deps.ledger.getAccount(settlementAccountId);
    assert.strictEqual(settlement?.balanceMinorUnits, -12500n, "double entry: the settlement account is debited");
  });

  it("labels a fallback payment as classical, so the customer-visible record never overstates its protection", async () => {
    const url = "/partner/v1/payments";
    const res = await post(payment(), { assertion: assertionFor("POST", url, { keyExchange: "classical", negotiatedGroup: "X25519", decision: "allowed-fallback" }) });
    assert.strictEqual(res.statusCode, 201);
    assert.deepStrictEqual(res.json().metadata.context.tls, { keyExchange: "classical", negotiatedGroup: "X25519", decision: "allowed-fallback" });
  });

  it("writes an audit entry linked to the sidecar's correlation id", async () => {
    const assertion = assertionFor("POST", "/partner/v1/payments", { correlationId: "11111111-2222-4333-8444-555555555555" });
    const res = await post(payment(), { assertion });
    const events = await t.stores.audit.list({ limit: 10, action: "partner.payment.create" });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]?.resourceId, res.json().id);
    assert.strictEqual(events[0]?.actorRole, "partner");
    assert.strictEqual(events[0]?.correlationId, "11111111-2222-4333-8444-555555555555");
    assert.strictEqual((events[0]?.details as { negotiatedGroup: string }).negotiatedGroup, "X25519MLKEM768");
  });

  describe("the assertion is mandatory and unforgeable", () => {
    it("rejects a request with no assertion", async () => {
      const res = await post(payment(), { assertion: null });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json().error.code, "PARTNER_ASSERTION_INVALID");
      assert.strictEqual(await balance(), "0");
    });

    it("rejects an assertion signed with the wrong secret, a tampered payload and garbage", async () => {
      const forged = signAssertion(assertionFor("POST", "/partner/v1/payments"), "x".repeat(40));
      assert.strictEqual((await post(payment(), { assertion: forged })).statusCode, 401);
      const genuine = signAssertion(assertionFor("POST", "/partner/v1/payments"), SECRET);
      const tampered = `${Buffer.from(JSON.stringify(assertionFor("POST", "/partner/v1/payments", { peerName: "Admin" }))).toString("base64url")}.${genuine.split(".")[1]}`;
      assert.strictEqual((await post(payment(), { assertion: tampered })).statusCode, 401);
      assert.strictEqual((await post(payment(), { assertion: "garbage" })).statusCode, 401);
      assert.strictEqual(await balance(), "0");
    });

    it("rejects a stale assertion (replay window)", async () => {
      const old = assertionFor("POST", "/partner/v1/payments", { iat: Math.floor(Date.now() / 1000) - 120 });
      assert.strictEqual((await post(payment(), { assertion: old })).statusCode, 401);
    });

    it("rejects a replayed assertion (the same jti cannot be used twice)", async () => {
      // Same signed token twice, with different idempotency keys so idempotency is not what blocks it.
      const token = signAssertion(assertionFor("POST", "/partner/v1/payments"), SECRET);
      const first = await post(payment(), { assertion: token, key: randomUUID() });
      assert.strictEqual(first.statusCode, 201, first.body);
      const replay = await post(payment(), { assertion: token, key: randomUUID() });
      assert.strictEqual(replay.statusCode, 401, "a captured assertion cannot be replayed");
      assert.strictEqual(replay.json().error.code, "PARTNER_ASSERTION_INVALID");
      assert.strictEqual(await balance(), "12500", "only the first payment posted");
    });

    it("rejects an assertion bound to a different path or method (cannot be reused for another request)", async () => {
      const forPing = assertionFor("GET", "/partner/v1/ping");
      assert.strictEqual((await post(payment(), { assertion: forPing })).statusCode, 401);
      const forOtherPath = assertionFor("POST", "/partner/v1/other");
      assert.strictEqual((await post(payment(), { assertion: forOtherPath })).statusCode, 401);
    });

    it("never accepts an assertion for a decision other than an accepted connection", async () => {
      for (const decision of ["rejected-violation", "rejected-unknown-peer", "handshake-failed"]) {
        const res = await post(payment(), { assertion: assertionFor("POST", "/partner/v1/payments", { decision }) });
        assert.strictEqual(res.statusCode, 401, decision);
      }
    });

    it("cannot be reached with a user access token instead of an assertion", async () => {
      const operator = await t.staff("operator");
      const res = await t.app.inject({ method: "POST", url: "/partner/v1/payments", headers: { ...t.bearer(operator.token), "idempotency-key": randomUUID() }, payload: payment() });
      assert.strictEqual(res.statusCode, 401);
    });

    it("an assertion grants nothing on the user-facing API", async () => {
      const token = signAssertion(assertionFor("GET", "/accounts"), SECRET);
      const res = await t.app.inject({ method: "GET", url: "/accounts", headers: { "x-sidecar-assertion": token } });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json().error.code, "AUTH_REQUIRED");
    });

    it("is disabled entirely when no assertion secret is configured", async () => {
      const off = await createTestApp({});
      const res = await off.app.inject({ method: "GET", url: "/partner/v1/ping", headers: { "x-sidecar-assertion": signAssertion(assertionFor("GET", "/partner/v1/ping"), SECRET) } });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.json().error.code, "PARTNER_API_DISABLED");
    });
  });

  describe("payment rules", () => {
    it("rejects zero, negative, fractional and oversized amounts - partners cannot reverse the direction", async () => {
      for (const amountMinorUnits of ["0", "-100", "1.5", "abc", "9".repeat(16)]) {
        assert.strictEqual((await post(payment({ amountMinorUnits }))).statusCode, 400, amountMinorUnits);
      }
      assert.strictEqual(await balance(), "0");
      assert.strictEqual((await t.deps.ledger.getAccount(settlementAccountId))?.balanceMinorUnits, 0n);
    });

    it("cannot credit a bank-internal settlement account, nor an unknown account (same 404)", async () => {
      assert.strictEqual((await post(payment({ toAccountId: settlementAccountId }))).statusCode, 404);
      assert.strictEqual((await post(payment({ toAccountId: "acc_nope" }))).statusCode, 404);
    });

    it("enforces currency match and validates the reference", async () => {
      assert.strictEqual((await post(payment({ currency: "USD" }))).statusCode, 400);
      assert.strictEqual((await post(payment({ reference: "" }))).statusCode, 400);
      assert.strictEqual((await post(payment({ reference: "x".repeat(101) }))).statusCode, 400);
      assert.strictEqual((await post(payment({ reference: "bad\u0007ref" }))).statusCode, 400);
      assert.strictEqual((await post({ toAccountId: customerAccountId })).statusCode, 400);
    });

    it("requires an Idempotency-Key", async () => {
      const url = "/partner/v1/payments";
      const res = await t.app.inject({ method: "POST", url, headers: { "x-sidecar-assertion": signAssertion(assertionFor("POST", url), SECRET) }, payload: payment() });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json().error.code, "MISSING_IDEMPOTENCY_KEY");
    });

    it("replays a retried payment instead of paying twice, and scopes keys per peer", async () => {
      const key = randomUUID();
      const first = await post(payment(), { key });
      const retry = await post(payment(), { key, assertion: assertionFor("POST", "/partner/v1/payments", { correlationId: randomUUID() }) });
      assert.strictEqual(retry.json().id, first.json().id);
      assert.strictEqual(await balance(), "12500");

      const otherPeer = await post(payment(), { key, assertion: assertionFor("POST", "/partner/v1/payments", { peerId: "peer-legacy-psp", peerName: "Simulated Legacy PSP" }) });
      assert.strictEqual(otherPeer.statusCode, 201);
      assert.notStrictEqual(otherPeer.json().id, first.json().id);
      assert.strictEqual(await balance(), "25000");
    });

    it("reports 503 when the partner settlement account has not been provisioned", async () => {
      const bare = await createTestApp({ sidecarAssertionSecret: SECRET });
      const url = "/partner/v1/payments";
      const res = await bare.app.inject({
        method: "POST",
        url,
        headers: { "idempotency-key": randomUUID(), "x-sidecar-assertion": signAssertion(assertionFor("POST", url), SECRET) },
        payload: payment(),
      });
      assert.strictEqual(res.statusCode, 503);
      assert.strictEqual(res.json().error.code, "PARTNER_NOT_PROVISIONED");
    });
  });

  it("answers ping with exactly what the sidecar asserted", async () => {
    const url = "/partner/v1/ping";
    const res = await t.app.inject({ method: "GET", url, headers: { "x-sidecar-assertion": signAssertion(assertionFor("GET", url), SECRET) } });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json().tls, { keyExchange: "hybrid", negotiatedGroup: "X25519MLKEM768", decision: "allowed-hybrid" });
    assert.strictEqual(res.json().peer.name, "Simulated Hybrid Bank");
  });

  it("rate-limits per peer, not per source address (all peers share the sidecar's address)", async () => {
    const limited = await createTestApp({ sidecarAssertionSecret: SECRET });
    const url = "/partner/v1/ping";
    const call = (peerId: string) =>
      limited.app.inject({ method: "GET", url, headers: { "x-sidecar-assertion": signAssertion(assertionFor("GET", url, { peerId }), SECRET) } });
    let throttled = 0;
    for (let i = 0; i < 125; i++) if ((await call("noisy-peer")).statusCode === 429) throttled += 1;
    assert.ok(throttled >= 4, `the noisy peer is throttled (got ${throttled})`);
    assert.strictEqual((await call("quiet-peer")).statusCode, 200, "another peer is unaffected");
  });

  it("keeps the assertion module byte-identical to the sidecar's copy (both sides must sign and verify the same way)", () => {
    // dist/tests/http/partner.test.js -> repository root
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const theirs = path.join(root, "pqc-sidecar/src/sidecar/assertion.ts");
    const mine = path.join(root, "ledger-service/src/partner/assertion.ts");
    const strip = (s: string) => s.replace(/^\/\/ KEEP IN SYNC[^\n]*\n/, "");
    try {
      assert.strictEqual(strip(readFileSync(mine, "utf8")), strip(readFileSync(theirs, "utf8")));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // package checked out on its own
      throw err;
    }
  });

  it("verifies what the sidecar signs (round trip through the shared module)", () => {
    const a = assertionFor("POST", "/partner/v1/payments");
    assert.deepStrictEqual(verifyAssertion(signAssertion(a, SECRET), SECRET, { method: "POST", path: "/partner/v1/payments" }), a);
  });
});
