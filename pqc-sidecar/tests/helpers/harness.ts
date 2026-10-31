import http from "node:http";
import type net from "node:net";
import pino from "pino";
import { createUntrustedCertificate, issuePeerCertificate, type Identity } from "../../src/pki/generate.js";
import { CLASSICAL_ONLY_GROUPS, HYBRID_CAPABLE_GROUPS, connectAsPeer, type PeerConnectResult, type PeerRequest } from "../../src/peers/client.js";
import type { PeerProfile, PeerRecord } from "../../src/policy/evaluate.js";
import { Sidecar, type SidecarOptions } from "../../src/sidecar/server.js";
import type { ConnectionEventPayload, SidecarConfigPayload } from "../../src/sidecar/types.js";
import { testPki, type TestPki } from "./tls-fixture.js";

export const ASSERTION_SECRET = "test-assertion-secret-0123456789abcdef0123456789";

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface FakeCore {
  url: URL;
  /** When set, answers requests instead of the default echo (used to emulate the real partner API). */
  respond: ((req: ReceivedRequest) => { status: number; body: unknown } | undefined) | undefined;
  requests: ReceivedRequest[];
  /** Set to make the next requests fail like a crashed core. */
  down: boolean;
  close(): Promise<void>;
}

export async function startFakeCore(): Promise<FakeCore> {
  const requests: ReceivedRequest[] = [];
  const core: FakeCore = { url: new URL("http://127.0.0.1:1"), respond: undefined, requests, down: false, close: async () => {} };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (core.down) {
        req.socket.destroy();
        return;
      }
      const received: ReceivedRequest = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      requests.push(received);
      const custom = core.respond?.(received);
      const body = JSON.stringify(custom ? custom.body : { ok: true, path: req.url });
      res.writeHead(custom?.status ?? 200, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "keep-alive" });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  core.url = new URL(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  core.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return core;
}

export interface PeerFixture {
  record: PeerRecord;
  identity: Identity;
}

export interface Harness {
  sidecar: Sidecar;
  port: number;
  pki: TestPki;
  core: FakeCore;
  events: ConnectionEventPayload[];
  peers: { hybridBank: PeerFixture; legacyPsp: PeerFixture; strictBank: PeerFixture; disabledPeer: PeerFixture };
  unregistered: Identity;
  rogue: Identity;
  config(overrides?: { version?: number; groups?: string[]; profile?: string; peers?: PeerRecord[] }): SidecarConfigPayload;
  connect(opts: { identity?: Identity | undefined; groups?: string; request?: PeerRequest; timeoutMs?: number }): Promise<PeerConnectResult>;
  /** Waits until at least `count` events have been recorded (events are emitted synchronously, this just yields). */
  stop(): Promise<void>;
}

let peerCache: Promise<{ hybridBank: Identity; legacyPsp: Identity; strictBank: Identity; disabledPeer: Identity; unregistered: Identity; rogue: Identity }> | undefined;

function peerIdentities() {
  peerCache ??= (async () => {
    const pki = await testPki();
    const issue = (cn: string) => issuePeerCertificate(pki.ca, { commonName: cn });
    return {
      hybridBank: await issue("hybrid-bank"),
      legacyPsp: await issue("legacy-psp"),
      strictBank: await issue("strict-bank"),
      disabledPeer: await issue("disabled-peer"),
      unregistered: await issue("unregistered-peer"),
      rogue: await createUntrustedCertificate("rogue"),
    };
  })();
  return peerCache;
}

export async function startHarness(opts: { configured?: boolean; maxConnections?: number; handshakeTimeoutMs?: number; maxBodyBytes?: number } = {}): Promise<Harness> {
  const pki = await testPki();
  const ids = await peerIdentities();
  const core = await startFakeCore();
  const events: ConnectionEventPayload[] = [];

  const record = (id: string, name: string, identity: Identity, profile: PeerProfile, enabled = true): PeerFixture => ({
    record: { id, name, certSha256: identity.sha256, profile, enabled },
    identity,
  });
  const peers = {
    hybridBank: record("11111111-1111-4111-8111-111111111111", "Hybrid Bank", ids.hybridBank, "hybrid-required"),
    legacyPsp: record("22222222-2222-4222-8222-222222222222", "Legacy PSP", ids.legacyPsp, "classical-allowed"),
    strictBank: record("33333333-3333-4333-8333-333333333333", "Strict Bank", ids.strictBank, "hybrid-required"),
    disabledPeer: record("44444444-4444-4444-8444-444444444444", "Disabled Peer", ids.disabledPeer, "classical-allowed", false),
  };

  const options: SidecarOptions = {
    host: "127.0.0.1",
    port: 0,
    tls: { keyPem: pki.server.keyPem, certPem: pki.server.certPem, peerCaPem: pki.ca.certPem },
    upstreamUrl: core.url,
    assertionSecret: ASSERTION_SECRET,
    instanceId: "test-sidecar",
    events: { emit: (e) => events.push(e) },
    logger: pino({ level: "silent" }),
    ...(opts.maxConnections !== undefined ? { maxConnections: opts.maxConnections } : {}),
    ...(opts.handshakeTimeoutMs !== undefined ? { handshakeTimeoutMs: opts.handshakeTimeoutMs } : {}),
    ...(opts.maxBodyBytes !== undefined ? { maxBodyBytes: opts.maxBodyBytes } : {}),
  };
  const sidecar = new Sidecar(options);

  const config = (o: { version?: number; groups?: string[]; profile?: string; peers?: PeerRecord[] } = {}): SidecarConfigPayload => ({
    version: o.version ?? 1,
    tlsProfile: { name: o.profile ?? "hybrid-preferred", groups: o.groups ?? ["X25519MLKEM768", "X25519"], description: "test" },
    peers: o.peers ?? Object.values(peers).map((p) => p.record),
    generatedAt: new Date().toISOString(),
  });
  if (opts.configured !== false) sidecar.applyConfig(config());
  const port = await sidecar.start();

  return {
    sidecar,
    port,
    pki,
    core,
    events,
    peers,
    unregistered: ids.unregistered,
    rogue: ids.rogue,
    config,
    connect: (o) =>
      connectAsPeer({
        host: "127.0.0.1",
        port: sidecar.port,
        caPem: pki.ca.certPem,
        groups: o.groups ?? HYBRID_CAPABLE_GROUPS,
        ...(o.identity ? { identity: o.identity } : {}),
        ...(o.request ? { request: o.request } : {}),
        ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
      }),
    stop: async () => {
      await sidecar.stop();
      await core.close();
    },
  };
}

export { CLASSICAL_ONLY_GROUPS, HYBRID_CAPABLE_GROUPS };
