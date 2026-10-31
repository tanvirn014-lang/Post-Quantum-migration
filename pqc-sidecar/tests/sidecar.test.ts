import net from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyAssertion } from "../src/sidecar/assertion.js";
import { ASSERTION_SECRET, CLASSICAL_ONLY_GROUPS, HYBRID_CAPABLE_GROUPS, startHarness, type Harness } from "./helpers/harness.js";

const get = (path: string) => ({ method: "GET", path });

describe("sidecar: per-peer policy enforcement over real TLS 1.3", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.stop();
  });

  describe("hybrid-capable peer", () => {
    it("negotiates X25519MLKEM768, is allowed, and the core receives a signed assertion naming the verified group", async () => {
      const r = await h.connect({ identity: h.peers.hybridBank.identity, request: get("/partner/v1/ping") });
      assert.strictEqual(r.connected, true, r.error);
      assert.strictEqual(r.protocol, "TLSv1.3");
      assert.strictEqual(r.response?.status, 200);

      const [event] = h.events;
      assert.strictEqual(event?.decision, "allowed-hybrid");
      assert.strictEqual(event?.keyExchange, "hybrid");
      assert.strictEqual(event?.negotiatedGroup, "X25519MLKEM768");
      assert.strictEqual(event?.negotiatedGroupCode, 0x11ec);
      assert.strictEqual(event?.clientKeyShareBytes, 1216);
      assert.strictEqual(event?.serverKeyShareBytes, 1120);
      assert.strictEqual(event?.peerName, "Hybrid Bank");
      assert.strictEqual(event?.expectedProfile, "hybrid-required");
      assert.strictEqual(event?.tlsVersion, "TLSv1.3");
      assert.ok(event && event.handshakeMs! > 0);
      assert.strictEqual(event?.configVersion, 1);
      assert.deepStrictEqual(event?.offeredGroups.map((g) => g.name), ["X25519MLKEM768", "X25519"]);

      const forwarded = h.core.requests[0]!;
      assert.strictEqual(forwarded.url, "/partner/v1/ping");
      const assertion = verifyAssertion(String(forwarded.headers["x-sidecar-assertion"]), ASSERTION_SECRET, { method: "GET", path: "/partner/v1/ping" });
      assert.ok(assertion, "assertion must verify");
      assert.strictEqual(assertion.peerName, "Hybrid Bank");
      assert.strictEqual(assertion.keyExchange, "hybrid");
      assert.strictEqual(assertion.negotiatedGroup, "X25519MLKEM768");
      assert.strictEqual(assertion.correlationId, event?.correlationId);
      assert.strictEqual(forwarded.headers["x-request-id"], event?.correlationId);
    });

    it("lets the peer see what the sidecar observed (whoami)", async () => {
      const r = await h.connect({ identity: h.peers.hybridBank.identity, request: get("/sidecar/whoami") });
      const body = r.response?.json as { decision: string; negotiatedGroup: string; peer: { name: string }; note: string };
      assert.strictEqual(body.decision, "allowed-hybrid");
      assert.strictEqual(body.negotiatedGroup, "X25519MLKEM768");
      assert.strictEqual(body.peer.name, "Hybrid Bank");
      assert.match(body.note, /plain HTTP/);
      assert.strictEqual(h.core.requests.length, 0, "whoami is answered by the sidecar, not the core");
    });
  });

  describe("classical fallback is an explicit per-peer decision", () => {
    it("classical-allowed peer on X25519: allowed, labelled as fallback, forwarded", async () => {
      const r = await h.connect({ identity: h.peers.legacyPsp.identity, groups: CLASSICAL_ONLY_GROUPS, request: get("/partner/v1/ping") });
      assert.strictEqual(r.response?.status, 200, r.error);
      const [event] = h.events;
      assert.strictEqual(event?.decision, "allowed-fallback");
      assert.strictEqual(event?.keyExchange, "classical");
      assert.strictEqual(event?.negotiatedGroup, "X25519");
      assert.strictEqual(event?.serverKeyShareBytes, 32);
      assert.match(event!.reason, /no post-quantum key-establishment protection/);
      const assertion = verifyAssertion(String(h.core.requests[0]!.headers["x-sidecar-assertion"]), ASSERTION_SECRET);
      assert.strictEqual(assertion?.keyExchange, "classical");
      assert.strictEqual(assertion?.decision, "allowed-fallback");
    });

    it("classical-allowed peer that CAN do hybrid still gets hybrid (fallback is not preferred)", async () => {
      const r = await h.connect({ identity: h.peers.legacyPsp.identity, request: get("/sidecar/whoami") });
      assert.strictEqual((r.response?.json as { decision: string }).decision, "allowed-hybrid");
    });

    it("hybrid-required peer forced onto X25519: REJECTED as a policy violation, nothing reaches the core", async () => {
      const r = await h.connect({ identity: h.peers.strictBank.identity, groups: CLASSICAL_ONLY_GROUPS, request: get("/partner/v1/ping") });
      assert.strictEqual(r.connected, true, "the TLS handshake itself succeeds; policy rejects afterwards");
      assert.strictEqual(r.response?.status, 403);
      assert.strictEqual((r.response?.json as { error: { code: string } }).error.code, "POLICY_VIOLATION");
      assert.strictEqual(h.core.requests.length, 0);
      const [event] = h.events;
      assert.strictEqual(event?.decision, "rejected-violation");
      assert.strictEqual(event?.peerName, "Strict Bank");
      assert.strictEqual(event?.expectedProfile, "hybrid-required");
      assert.strictEqual(event?.negotiatedGroup, "X25519");
      assert.match(event!.reason, /hybrid-required/);
    });

    it("every connection that completes a handshake ends in exactly one classified decision (H3)", async () => {
      const attempts = [
        { identity: h.peers.hybridBank.identity, groups: HYBRID_CAPABLE_GROUPS },
        { identity: h.peers.hybridBank.identity, groups: CLASSICAL_ONLY_GROUPS },
        { identity: h.peers.legacyPsp.identity, groups: CLASSICAL_ONLY_GROUPS },
        { identity: h.peers.strictBank.identity, groups: CLASSICAL_ONLY_GROUPS },
        { identity: h.unregistered, groups: HYBRID_CAPABLE_GROUPS },
        { identity: h.rogue, groups: CLASSICAL_ONLY_GROUPS },
        { identity: undefined, groups: HYBRID_CAPABLE_GROUPS },
      ];
      for (const a of attempts) await h.connect({ ...a, request: get("/sidecar/whoami") });
      assert.strictEqual(h.events.length, attempts.length);
      const classicalWithoutLabel = h.events.filter(
        (e) => e.keyExchange === "classical" && e.decision !== "allowed-fallback" && !e.decision.startsWith("rejected"),
      );
      assert.deepStrictEqual(classicalWithoutLabel, [], "no classical negotiation may be unclassified");
    });
  });

  describe("peer identity", () => {
    it("denies a certificate from the trusted CA whose fingerprint is not registered (deny by default)", async () => {
      const r = await h.connect({ identity: h.unregistered, request: get("/partner/v1/ping") });
      assert.strictEqual(r.response?.status, 403);
      assert.strictEqual((r.response?.json as { error: { code: string } }).error.code, "PEER_NOT_AUTHORIZED");
      assert.strictEqual(h.core.requests.length, 0);
      assert.strictEqual(h.events[0]?.decision, "rejected-unknown-peer");
      assert.match(h.events[0]!.reason, /not registered/);
      assert.strictEqual(h.events[0]?.peerName, undefined);
    });

    it("denies a self-signed certificate that does not chain to the peer CA", async () => {
      const r = await h.connect({ identity: h.rogue, request: get("/partner/v1/ping") });
      assert.strictEqual(r.response?.status, 403);
      assert.strictEqual(h.events[0]?.decision, "rejected-unknown-peer");
      assert.match(h.events[0]!.reason, /not issued by the trusted peer CA/);
    });

    it("denies a connection with no client certificate", async () => {
      const r = await h.connect({ request: get("/partner/v1/ping") });
      assert.strictEqual(r.response?.status, 403);
      assert.strictEqual(h.events[0]?.decision, "rejected-unknown-peer");
      assert.match(h.events[0]!.reason, /no client certificate/);
    });

    it("denies a registered but disabled peer", async () => {
      const r = await h.connect({ identity: h.peers.disabledPeer.identity, groups: CLASSICAL_ONLY_GROUPS, request: get("/partner/v1/ping") });
      assert.strictEqual(r.response?.status, 403);
      assert.match(h.events[0]!.reason, /disabled/);
    });

    it("does not reveal registry contents in the rejection body", async () => {
      const r = await h.connect({ identity: h.unregistered, request: get("/partner/v1/ping") });
      assert.doesNotMatch(r.response!.body, /fingerprint|registered|Hybrid Bank|Legacy PSP/i);
    });
  });

  describe("configuration changes apply to new connections", () => {
    it("hybrid-only profile makes a classical-only handshake fail, with an observable reason and the offered groups", async () => {
      h.sidecar.applyConfig(h.config({ version: 2, profile: "hybrid-only", groups: ["X25519MLKEM768"] }));
      const r = await h.connect({ identity: h.peers.legacyPsp.identity, groups: CLASSICAL_ONLY_GROUPS });
      assert.strictEqual(r.connected, false);
      const [event] = h.events;
      assert.strictEqual(event?.decision, "handshake-failed");
      assert.strictEqual(event?.configVersion, 2);
      assert.deepStrictEqual(event?.offeredGroups.map((g) => g.code), [0x1d]);
      assert.match(event!.reason, /server alert 40|handshake/i);
    });

    it("classical-baseline profile negotiates X25519 even with a hybrid-capable peer", async () => {
      h.sidecar.applyConfig(h.config({ version: 3, profile: "classical-baseline", groups: ["X25519"] }));
      const r = await h.connect({ identity: h.peers.legacyPsp.identity, request: get("/sidecar/whoami") });
      const body = r.response?.json as { decision: string; negotiatedGroup: string };
      assert.strictEqual(body.negotiatedGroup, "X25519");
      assert.strictEqual(body.decision, "allowed-fallback");
    });

    it("switching back to hybrid-preferred restores hybrid for new connections (experiment E)", async () => {
      h.sidecar.applyConfig(h.config({ version: 2, profile: "classical-baseline", groups: ["X25519"] }));
      const before = await h.connect({ identity: h.peers.legacyPsp.identity, request: get("/sidecar/whoami") });
      assert.strictEqual((before.response?.json as { negotiatedGroup: string }).negotiatedGroup, "X25519");
      h.sidecar.applyConfig(h.config({ version: 3 }));
      const after = await h.connect({ identity: h.peers.legacyPsp.identity, request: get("/sidecar/whoami") });
      assert.strictEqual((after.response?.json as { negotiatedGroup: string }).negotiatedGroup, "X25519MLKEM768");
      assert.deepStrictEqual(h.events.map((e) => e.configVersion), [2, 3]);
    });

    it("applies peer registry changes immediately to new connections", async () => {
      assert.strictEqual((await h.connect({ identity: h.unregistered, request: get("/sidecar/whoami") })).response?.status, 403);
      const unregistered = { id: "55555555-5555-4555-8555-555555555555", name: "Newly Registered", certSha256: h.unregistered.sha256, profile: "hybrid-required" as const, enabled: true };
      h.sidecar.applyConfig(h.config({ version: 2, peers: [...Object.values(h.peers).map((p) => p.record), unregistered] }));
      const r = await h.connect({ identity: h.unregistered, request: get("/sidecar/whoami") });
      assert.strictEqual(r.response?.status, 200);
      assert.strictEqual((r.response?.json as { peer: { name: string } }).peer.name, "Newly Registered");
    });

    it("rejects a configuration it cannot apply and keeps enforcing the previous one", () => {
      const result = h.sidecar.applyConfig(h.config({ version: 9, groups: ["NotARealGroup"] }));
      assert.strictEqual(result.applied, false);
      assert.strictEqual(h.sidecar.status().appliedConfigVersion, 1);
      assert.strictEqual(h.sidecar.status().counters.configsRejected, 1);
    });

    it("reports the applied version and profile in its status", () => {
      h.sidecar.applyConfig(h.config({ version: 4, profile: "hybrid-only", groups: ["X25519MLKEM768"] }));
      const status = h.sidecar.status();
      assert.strictEqual(status.appliedConfigVersion, 4);
      assert.strictEqual(status.activeProfile, "hybrid-only");
      assert.deepStrictEqual(status.groups, ["X25519MLKEM768"]);
    });
  });

  describe("request forwarding", () => {
    it("forwards only the partner API; everything else is 404 and never reaches the core", async () => {
      for (const path of ["/accounts", "/auth/login", "/partner/v2/x", "/healthz", "/partner/v1/../accounts", "/%2e%2e/accounts"]) {
        const r = await h.connect({ identity: h.peers.hybridBank.identity, request: get(path) });
        assert.strictEqual(r.response?.status, 404, path);
      }
      assert.strictEqual(h.core.requests.length, 0);
    });

    it("strips identity-spoofing headers a peer might send and replaces the request id", async () => {
      await h.connect({
        identity: h.peers.hybridBank.identity,
        request: {
          method: "GET",
          path: "/partner/v1/ping",
          headers: { "x-sidecar-assertion": "forged", "x-pqc-peer": "admin", authorization: "Bearer stolen", cookie: "a=b", "x-request-id": "attacker-chosen-id", "x-forwarded-for": "10.0.0.1" },
        },
      });
      const forwarded = h.core.requests[0]!.headers;
      assert.notStrictEqual(forwarded["x-sidecar-assertion"], "forged");
      assert.ok(verifyAssertion(String(forwarded["x-sidecar-assertion"]), ASSERTION_SECRET));
      for (const name of ["x-pqc-peer", "authorization", "cookie", "x-forwarded-for"]) assert.strictEqual(forwarded[name], undefined, name);
      assert.notStrictEqual(forwarded["x-request-id"], "attacker-chosen-id");
    });

    it("forwards a POST body and the upstream status", async () => {
      const body = JSON.stringify({ amountMinorUnits: "100" });
      const r = await h.connect({ identity: h.peers.hybridBank.identity, request: { method: "POST", path: "/partner/v1/payments", headers: { "content-type": "application/json" }, body } });
      assert.strictEqual(r.response?.status, 200);
      assert.strictEqual(h.core.requests[0]?.body, body);
      assert.strictEqual(h.core.requests[0]?.method, "POST");
      assert.ok(r.response?.headers["x-pqc-correlation-id"]);
    });

    it("answers 502 when the core is down", async () => {
      h.core.down = true;
      const r = await h.connect({ identity: h.peers.hybridBank.identity, request: get("/partner/v1/ping") });
      assert.strictEqual(r.response?.status, 502);
      assert.strictEqual((r.response?.json as { error: { code: string } }).error.code, "UPSTREAM_UNAVAILABLE");
      assert.strictEqual(h.sidecar.status().counters.upstreamErrors, 1);
    });
  });
});

describe("sidecar: resource limits and hostile input", () => {
  it("rejects an oversized declared body with 413 before forwarding", async () => {
    const h = await startHarness({ maxBodyBytes: 1024 });
    try {
      const r = await h.connect({ identity: h.peers.hybridBank.identity, request: { method: "POST", path: "/partner/v1/payments", body: "x".repeat(4096) } });
      assert.strictEqual(r.response?.status, 413);
      assert.strictEqual(h.core.requests.length, 0);
    } finally {
      await h.stop();
    }
  });

  it("fails closed: with no configuration applied it accepts no connections", async () => {
    const h = await startHarness({ configured: false });
    try {
      const r = await h.connect({ identity: h.peers.hybridBank.identity, request: get("/partner/v1/ping"), timeoutMs: 2000 });
      assert.strictEqual(r.connected, false);
      assert.strictEqual(h.events.length, 0);
      assert.strictEqual(h.sidecar.status().ready, false);
    } finally {
      await h.stop();
    }
  });

  it("records non-TLS traffic as a failed handshake without crashing", async () => {
    const h = await startHarness();
    try {
      await new Promise<void>((resolve) => {
        const s = net.connect(h.port, "127.0.0.1", () => s.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
        s.on("close", () => resolve());
        s.on("error", () => resolve());
        setTimeout(() => s.destroy(), 1500);
      });
      assert.strictEqual(h.events.length, 1);
      assert.strictEqual(h.events[0]?.decision, "handshake-failed");
      assert.match(h.events[0]!.reason, /not a TLS ClientHello|handshake failed|closed/i);
      const ok = await h.connect({ identity: h.peers.hybridBank.identity, request: get("/sidecar/whoami") });
      assert.strictEqual(ok.response?.status, 200, "still serving after hostile input");
    } finally {
      await h.stop();
    }
  });

  it("ignores a connection that sends nothing (port probes are not handshakes)", async () => {
    const h = await startHarness();
    try {
      await new Promise<void>((resolve) => {
        const s = net.connect(h.port, "127.0.0.1", () => s.end());
        s.on("close", () => resolve());
      });
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(h.events.length, 0);
    } finally {
      await h.stop();
    }
  });

  it("times out a handshake that stalls after a partial ClientHello", async () => {
    const h = await startHarness({ handshakeTimeoutMs: 300 });
    try {
      const closed = new Promise<void>((resolve) => {
        const s = net.connect(h.port, "127.0.0.1", () => s.write(Buffer.from([22, 3, 1, 0x02, 0x00, 1, 0, 1, 0xfc, 3, 3])));
        s.on("close", () => resolve());
        s.on("error", () => resolve());
      });
      await closed;
      assert.strictEqual(h.events.length, 1);
      assert.match(h.events[0]!.reason, /timed out/);
    } finally {
      await h.stop();
    }
  });

  it("refuses connections beyond the configured limit", async () => {
    const h = await startHarness({ maxConnections: 1 });
    try {
      const holder = net.connect(h.port, "127.0.0.1");
      await new Promise<void>((resolve) => holder.once("connect", () => resolve()));
      await new Promise((r) => setTimeout(r, 30));
      const r = await h.connect({ identity: h.peers.hybridBank.identity, request: get("/sidecar/whoami"), timeoutMs: 2000 });
      assert.strictEqual(r.connected, false);
      assert.strictEqual(h.sidecar.status().counters.connectionsRefusedOverLimit, 1);
      holder.destroy();
    } finally {
      await h.stop();
    }
  });

  it("serves many sequential peers without leaking connections", async () => {
    const h = await startHarness();
    try {
      for (let i = 0; i < 25; i++) await h.connect({ identity: h.peers.hybridBank.identity, request: get("/sidecar/whoami") });
      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(h.sidecar.status().openConnections, 0);
      assert.strictEqual(h.sidecar.status().counters.decisions["allowed-hybrid"], 25);
    } finally {
      await h.stop();
    }
  });
});
