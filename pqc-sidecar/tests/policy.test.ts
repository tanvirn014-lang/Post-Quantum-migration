import pino from "pino";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyKeyExchange, evaluatePolicy, type KeyExchange, type PeerRecord } from "../src/policy/evaluate.js";
import { signAssertion, verifyAssertion, type PeerAssertion } from "../src/sidecar/assertion.js";
import { ConfigClient, TelemetryClient } from "../src/sidecar/control-plane.js";
import type { ConnectionEventPayload, SidecarConfigPayload } from "../src/sidecar/types.js";
import { loadConfig } from "../src/config.js";

const silent = pino({ level: "silent" });
const sha = (c: string) => c.repeat(64);

const hybridRequired: PeerRecord = { id: "p1", name: "Hybrid Required", certSha256: sha("a"), profile: "hybrid-required", enabled: true };
const classicalAllowed: PeerRecord = { id: "p2", name: "Classical Allowed", certSha256: sha("b"), profile: "classical-allowed", enabled: true };
const disabled: PeerRecord = { id: "p3", name: "Disabled", certSha256: sha("c"), profile: "classical-allowed", enabled: false };
const registry = new Map([hybridRequired, classicalAllowed, disabled].map((p) => [p.certSha256, p]));

const trusted = (sha256: string) => ({ presented: true, trusted: true, sha256 });

describe("policy decision table (proposal 8.2, hypothesis H3)", () => {
  const rows: { name: string; cert: { presented: boolean; trusted: boolean; sha256: string | undefined }; kex: KeyExchange; decision: string; allowed: boolean }[] = [
    { name: "hybrid-required + hybrid", cert: trusted(sha("a")), kex: "hybrid", decision: "allowed-hybrid", allowed: true },
    { name: "hybrid-required + classical", cert: trusted(sha("a")), kex: "classical", decision: "rejected-violation", allowed: false },
    { name: "hybrid-required + unverifiable group", cert: trusted(sha("a")), kex: "unknown", decision: "rejected-violation", allowed: false },
    { name: "classical-allowed + hybrid", cert: trusted(sha("b")), kex: "hybrid", decision: "allowed-hybrid", allowed: true },
    { name: "classical-allowed + classical", cert: trusted(sha("b")), kex: "classical", decision: "allowed-fallback", allowed: true },
    { name: "classical-allowed + unverifiable group", cert: trusted(sha("b")), kex: "unknown", decision: "rejected-violation", allowed: false },
    { name: "disabled peer + hybrid", cert: trusted(sha("c")), kex: "hybrid", decision: "rejected-unknown-peer", allowed: false },
    { name: "unregistered fingerprint + hybrid", cert: trusted(sha("d")), kex: "hybrid", decision: "rejected-unknown-peer", allowed: false },
    { name: "untrusted certificate + hybrid", cert: { presented: true, trusted: false, sha256: sha("a") }, kex: "hybrid", decision: "rejected-unknown-peer", allowed: false },
    { name: "no certificate + hybrid", cert: { presented: false, trusted: false, sha256: undefined }, kex: "hybrid", decision: "rejected-unknown-peer", allowed: false },
    { name: "trusted but fingerprint missing", cert: { presented: true, trusted: true, sha256: undefined }, kex: "hybrid", decision: "rejected-unknown-peer", allowed: false },
  ];
  for (const row of rows) {
    it(row.name, () => {
      const outcome = evaluatePolicy({ peersBySha256: registry, certificate: row.cert, keyExchange: row.kex });
      assert.strictEqual(outcome.decision, row.decision);
      assert.strictEqual(outcome.allowed, row.allowed);
      assert.ok(outcome.reason.length > 0);
    });
  }

  it("never allows a classical negotiation without labelling it as fallback", () => {
    for (const peer of registry.values()) {
      const outcome = evaluatePolicy({ peersBySha256: registry, certificate: trusted(peer.certSha256), keyExchange: "classical" });
      if (outcome.allowed) assert.strictEqual(outcome.decision, "allowed-fallback");
    }
  });

  it("classifies the negotiated group code", () => {
    assert.deepStrictEqual(classifyKeyExchange(0x11ec), { keyExchange: "hybrid", name: "X25519MLKEM768" });
    assert.deepStrictEqual(classifyKeyExchange(0x1d), { keyExchange: "classical", name: "X25519" });
    assert.deepStrictEqual(classifyKeyExchange(undefined), { keyExchange: "unknown", name: undefined });
    assert.deepStrictEqual(classifyKeyExchange(0xbeef), { keyExchange: "unknown", name: undefined });
  });
});

describe("peer assertion (sidecar -> core)", () => {
  const secret = "s".repeat(40);
  const payload: PeerAssertion = { v: 2, peerId: "p1", peerName: "P1", keyExchange: "hybrid", negotiatedGroup: "X25519MLKEM768", decision: "allowed-hybrid", correlationId: "c1", iat: 1_000_000, jti: "jti-1", method: "POST", path: "/partner/v1/payments" };

  it("round-trips", () => {
    assert.deepStrictEqual(verifyAssertion(signAssertion(payload, secret), secret, { now: 1_000_005 }), payload);
  });

  it("rejects a wrong secret, a tampered payload and a truncated token", () => {
    const token = signAssertion(payload, secret);
    assert.strictEqual(verifyAssertion(token, "x".repeat(40), { now: 1_000_005 }), null);
    const [body, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...payload, peerName: "Admin" })).toString("base64url");
    assert.strictEqual(verifyAssertion(`${forged}.${sig}`, secret, { now: 1_000_005 }), null);
    assert.strictEqual(verifyAssertion(body, secret, { now: 1_000_005 }), null);
    assert.strictEqual(verifyAssertion("", secret), null);
    assert.strictEqual(verifyAssertion("a.b.c", secret), null);
  });

  it("rejects stale and future-dated assertions (replay window)", () => {
    const token = signAssertion(payload, secret);
    assert.ok(verifyAssertion(token, secret, { now: 1_000_029 }));
    assert.strictEqual(verifyAssertion(token, secret, { now: 1_000_031 }), null);
    assert.strictEqual(verifyAssertion(token, secret, { now: 999_960 }), null);
  });

  it("binds the assertion to the method and path it was issued for", () => {
    const token = signAssertion(payload, secret);
    assert.ok(verifyAssertion(token, secret, { now: 1_000_001, method: "POST", path: "/partner/v1/payments" }));
    assert.strictEqual(verifyAssertion(token, secret, { now: 1_000_001, method: "GET", path: "/partner/v1/payments" }), null);
    assert.strictEqual(verifyAssertion(token, secret, { now: 1_000_001, method: "POST", path: "/partner/v1/other" }), null);
  });
});

function fakeResponse(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

const goodConfig = (version: number): SidecarConfigPayload => ({
  version,
  tlsProfile: { name: "hybrid-preferred", groups: ["X25519MLKEM768", "X25519"], description: "d" },
  peers: [{ id: "p1", name: "P1", certSha256: sha("a"), profile: "hybrid-required", enabled: true }],
  generatedAt: new Date().toISOString(),
});

describe("config client", () => {
  const opts = (fetchImpl: typeof fetch) => ({ baseUrl: "http://control.test", token: "t".repeat(32), logger: silent, fetchImpl });

  it("applies a new configuration, then sends If-None-Match and treats 304 as no change", async () => {
    const applied: number[] = [];
    const seen: (string | null)[] = [];
    let call = 0;
    const client = new ConfigClient(opts(async (_url, init) => {
      seen.push(new Headers(init?.headers).get("if-none-match"));
      return call++ === 0 ? fakeResponse(200, goodConfig(7), { etag: '"v7"' }) : fakeResponse(304);
    }), (cfg) => (applied.push(cfg.version), { applied: true }));
    assert.strictEqual(await client.pollOnce(), true);
    assert.strictEqual(await client.pollOnce(), false);
    assert.deepStrictEqual(applied, [7]);
    assert.deepStrictEqual(seen, [null, '"v7"']);
  });

  it("sends the bearer token", async () => {
    let auth: string | null = null;
    const client = new ConfigClient(opts(async (_u, init) => ((auth = new Headers(init?.headers).get("authorization")), fakeResponse(200, goodConfig(1)))), () => ({ applied: true }));
    await client.pollOnce();
    assert.strictEqual(auth, `Bearer ${"t".repeat(32)}`);
  });

  it("keeps the last configuration and counts failures when the control plane is down, then recovers", async () => {
    let up = true;
    const client = new ConfigClient(opts(async () => (up ? fakeResponse(200, goodConfig(1)) : Promise.reject(new Error("ECONNREFUSED")))), () => ({ applied: true }));
    assert.strictEqual(await client.pollOnce(), true);
    up = false;
    assert.strictEqual(await client.pollOnce(), false);
    assert.strictEqual(await client.pollOnce(), false);
    assert.strictEqual(client.consecutiveFailures, 2);
    up = true;
    await client.pollOnce();
    assert.strictEqual(client.consecutiveFailures, 0);
  });

  it("rejects a malformed configuration instead of applying it", async () => {
    let applied = 0;
    const client = new ConfigClient(opts(async () => fakeResponse(200, { version: 1, tlsProfile: { name: "x", groups: [], description: "" }, peers: [], generatedAt: "" })), () => (applied++, { applied: true }));
    assert.strictEqual(await client.pollOnce(), false);
    assert.strictEqual(applied, 0);
    assert.strictEqual(client.consecutiveFailures, 1);
  });

  it("rejects a peer fingerprint that is not 64 lowercase hex characters", async () => {
    const bad = goodConfig(1);
    bad.peers[0]!.certSha256 = "ZZ";
    let applied = 0;
    const client = new ConfigClient(opts(async () => fakeResponse(200, bad)), () => (applied++, { applied: true }));
    assert.strictEqual(await client.pollOnce(), false);
    assert.strictEqual(applied, 0);
  });

  it("treats an HTTP error status as a failed poll", async () => {
    const client = new ConfigClient(opts(async () => fakeResponse(401, { error: "no" })), () => ({ applied: true }));
    assert.strictEqual(await client.pollOnce(), false);
    assert.strictEqual(client.consecutiveFailures, 1);
  });

  it("waitForInitialConfig resolves after the control plane comes up", async () => {
    let calls = 0;
    const client = new ConfigClient(opts(async () => (++calls < 3 ? Promise.reject(new Error("down")) : fakeResponse(200, goodConfig(1)))), () => ({ applied: true }));
    await client.waitForInitialConfig(10_000);
    assert.ok(calls >= 3);
  });

  it("waitForInitialConfig gives up with a clear error", async () => {
    const client = new ConfigClient(opts(async () => Promise.reject(new Error("down"))), () => ({ applied: true }));
    await assert.rejects(client.waitForInitialConfig(300), /timed out waiting for the initial configuration/);
  });
});

const event = (n: number): ConnectionEventPayload => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  correlationId: `c${n}`,
  occurredAt: new Date().toISOString(),
  offeredGroups: [],
  keyExchange: "hybrid",
  decision: "allowed-hybrid",
  reason: "r",
  configVersion: 1,
});

describe("telemetry client", () => {
  const make = (fetchImpl: typeof fetch, extra: object = {}) => new TelemetryClient({ baseUrl: "http://control.test", token: "t".repeat(32), logger: silent, fetchImpl, ...extra });

  it("ships queued events in one batch with the bearer token", async () => {
    const bodies: { events: ConnectionEventPayload[] }[] = [];
    const client = make(async (_u, init) => (bodies.push(JSON.parse(String(init?.body))), fakeResponse(202, { accepted: 1 })));
    [1, 2, 3].forEach((n) => client.emit(event(n)));
    await client.flush();
    assert.strictEqual(bodies.length, 1);
    assert.deepStrictEqual(bodies[0]!.events.map((e) => e.correlationId), ["c1", "c2", "c3"]);
    assert.strictEqual(client.queued, 0);
    assert.strictEqual(client.sent, 3);
  });

  it("keeps events and retries the same ids after a failure (the receiver is idempotent)", async () => {
    let fail = true;
    const attempts: string[][] = [];
    const client = make(async (_u, init) => {
      attempts.push((JSON.parse(String(init?.body)) as { events: { id: string }[] }).events.map((e) => e.id));
      return fail ? fakeResponse(503, {}) : fakeResponse(202, {});
    });
    client.emit(event(1));
    client.emit(event(2));
    await client.flush();
    assert.strictEqual(client.queued, 2);
    assert.strictEqual(client.failures, 1);
    fail = false;
    await client.flush();
    assert.strictEqual(client.queued, 0);
    assert.deepStrictEqual(attempts[0], attempts[1], "identical ids on retry");
  });

  it("bounds the queue and counts dropped events during a long outage", async () => {
    const client = make(async () => fakeResponse(503, {}), { maxQueue: 10, batchSize: 1000 });
    for (let i = 0; i < 25; i++) client.emit(event(i));
    assert.strictEqual(client.queued, 10);
    assert.strictEqual(client.dropped, 15);
  });

  it("splits large backlogs into batches of at most 100", async () => {
    const sizes: number[] = [];
    const client = make(async (_u, init) => (sizes.push((JSON.parse(String(init?.body)) as { events: unknown[] }).events.length), fakeResponse(202, {})), { maxQueue: 1000, batchSize: 10_000 });
    for (let i = 0; i < 250; i++) client.emit(event(i));
    await client.flush();
    assert.deepStrictEqual(sizes, [100, 100, 50]);
  });
});

describe("sidecar environment configuration", () => {
  const base = { TLS_KEY_FILE: "k", TLS_CERT_FILE: "c", PEER_CA_FILE: "ca", SIDECAR_TOKEN: "t".repeat(32), SIDECAR_ASSERTION_SECRET: "a".repeat(32) };

  it("applies safe defaults: loopback binding, loopback admin", () => {
    const c = loadConfig(base);
    assert.strictEqual(c.SIDECAR_HOST, "127.0.0.1");
    assert.strictEqual(c.SIDECAR_PORT, 8443);
  });

  it("requires key material paths and long secrets", () => {
    assert.throws(() => loadConfig({}), /TLS_KEY_FILE/);
    assert.throws(() => loadConfig({ ...base, SIDECAR_TOKEN: "short" }), /SIDECAR_TOKEN/);
    assert.throws(() => loadConfig({ ...base, SIDECAR_ASSERTION_SECRET: "short" }), /SIDECAR_ASSERTION_SECRET/);
  });
});
