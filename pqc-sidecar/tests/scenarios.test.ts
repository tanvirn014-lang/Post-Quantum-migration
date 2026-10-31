import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, runScenario, type ScenarioContext } from "../src/peers/scenarios.js";
import { GROUP_X25519, GROUP_X25519_MLKEM768 } from "../src/wire/groups.js";
import { startTamperProxy } from "../src/peers/tamper-proxy.js";
import { connectAsPeer, HYBRID_CAPABLE_GROUPS } from "../src/peers/client.js";
import { startHarness, type Harness } from "./helpers/harness.js";

describe("experiment scenarios B and C against a live sidecar", () => {
  let h: Harness;
  let ctx: ScenarioContext;

  beforeEach(async () => {
    h = await startHarness();
    ctx = {
      host: "127.0.0.1",
      port: h.port,
      caPem: h.pki.ca.certPem,
      identities: {
        hybridBank: h.peers.hybridBank.identity,
        legacyPsp: h.peers.legacyPsp.identity,
        strictBank: h.peers.strictBank.identity,
        unregistered: h.unregistered,
        rogue: h.rogue,
      },
    };
  });
  afterEach(async () => {
    await h.stop();
  });

  for (const def of SCENARIOS) {
    it(`${def.id}: peer observes '${def.expected}' under the default profile`, async () => {
      const result = await runScenario(def, ctx);
      assert.strictEqual(result.observed, def.expected, JSON.stringify(result.detail));
      assert.strictEqual(result.passed, true);
      assert.ok(result.durationMs >= 0 && result.startedAt);
    });
  }

  it("the sidecar's own telemetry agrees with what each peer observed (independent evidence)", async () => {
    const results = [];
    for (const def of SCENARIOS) results.push(await runScenario(def, ctx));
    // The sidecar logs a failed handshake a moment after the peer sees it fail.
    for (let i = 0; i < 40 && h.events.length < SCENARIOS.length; i++) await new Promise((r) => setTimeout(r, 25));
    const decisions = h.events.map((e) => e.decision).sort();
    assert.deepStrictEqual(decisions, [
      "allowed-fallback",
      "allowed-hybrid",
      "handshake-failed",
      "rejected-unknown-peer",
      "rejected-unknown-peer",
      "rejected-unknown-peer",
      "rejected-violation",
    ]);
    for (const r of results) assert.ok(r.passed, r.id);
  });

  it("scenario detail carries the measured handshake facts needed for hypothesis H1", async () => {
    const hybrid = await runScenario(SCENARIOS[0]!, ctx);
    const classical = await runScenario(SCENARIOS[1]!, ctx);
    assert.strictEqual(hybrid.detail.selectedGroup, "X25519MLKEM768");
    assert.strictEqual(hybrid.detail.serverKeyShareBytes, 1120);
    assert.strictEqual(classical.detail.selectedGroup, "X25519");
    assert.strictEqual(classical.detail.serverKeyShareBytes, 32);
    assert.ok(hybrid.detail.clientHelloBytes! > classical.detail.clientHelloBytes! + 1000);
    assert.strictEqual(hybrid.detail.protocol, "TLSv1.3");
  });

  it("under the hybrid-only profile the scenarios that need X25519 fail at the handshake, which is also accepted", async () => {
    h.sidecar.applyConfig(h.config({ version: 2, profile: "hybrid-only", groups: ["X25519MLKEM768"] }));
    const fallback = await runScenario(SCENARIOS.find((s) => s.id === "classical-peer-fallback-allowed")!, ctx);
    const forbidden = await runScenario(SCENARIOS.find((s) => s.id === "classical-peer-fallback-forbidden")!, ctx);
    assert.strictEqual(fallback.observed, "handshake-failed");
    assert.strictEqual(forbidden.observed, "handshake-failed");
    assert.strictEqual(fallback.passed, true);
    assert.strictEqual(forbidden.passed, true);
  });
});

describe("controlled ClientHello modification (experiment C)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.stop();
  });

  it("a pass-through of an unmodified hello would succeed, proving the failure is caused by the modification", async () => {
    // Control: the same peer straight to the sidecar completes with the hybrid group.
    const control = await connectAsPeer({ host: "127.0.0.1", port: h.port, caPem: h.pki.ca.certPem, groups: HYBRID_CAPABLE_GROUPS, identity: h.peers.hybridBank.identity, request: { method: "GET", path: "/sidecar/whoami" } });
    assert.strictEqual(control.response?.status, 200);
    assert.strictEqual(control.observation.serverHello?.selectedGroup, GROUP_X25519_MLKEM768);
  });

  it("stripping the hybrid group makes the handshake fail on both sides; it never completes on X25519", async () => {
    const proxy = await startTamperProxy({ targetHost: "127.0.0.1", targetPort: h.port, removeGroup: GROUP_X25519_MLKEM768 });
    try {
      const r = await connectAsPeer({ host: "127.0.0.1", port: proxy.port, caPem: h.pki.ca.certPem, groups: HYBRID_CAPABLE_GROUPS, identity: h.peers.hybridBank.identity, request: { method: "GET", path: "/partner/v1/ping" }, timeoutMs: 5000 });
      assert.strictEqual(proxy.tampered, 1);
      assert.strictEqual(r.connected, false, "the peer must not end up with a classical session");
      assert.strictEqual(h.core.requests.length, 0, "nothing was forwarded to the core");
      await new Promise((resolve) => setTimeout(resolve, 100));
      const [event] = h.events;
      assert.strictEqual(event?.decision, "handshake-failed", "the sidecar records a failed handshake, not an accepted classical connection");
      assert.deepStrictEqual(event?.offeredGroups.map((g) => g.code), [GROUP_X25519], "the sidecar only ever saw the modified hello");
      assert.strictEqual(event?.peerName, undefined, "the failure happens before the client authenticates");
    } finally {
      await proxy.close();
    }
  });

  it("the observation the sidecar logged would look like a legitimate classical-only client (documented visibility limit)", async () => {
    const classicalOnly = await connectAsPeer({ host: "127.0.0.1", port: h.port, caPem: h.pki.ca.certPem, groups: "X25519", identity: h.peers.legacyPsp.identity, request: { method: "GET", path: "/sidecar/whoami" } });
    assert.strictEqual(classicalOnly.response?.status, 200);
    const legit = h.events[0]!;
    assert.deepStrictEqual(legit.offeredGroups.map((g) => g.code), [GROUP_X25519]);
    // Same offered-group list as the tampered case above: from the hello alone the two are
    // indistinguishable to the server. The proposal's detector scope is therefore "policy
    // violations visible to the sidecar", not universal downgrade detection.
  });
});
