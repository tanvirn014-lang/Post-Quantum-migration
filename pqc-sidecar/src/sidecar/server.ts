import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { X509Certificate } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { performance } from "node:perf_hooks";
import type { Logger } from "pino";
import { classifyKeyExchange, evaluatePolicy, type PeerRecord, type PolicyOutcome } from "../policy/evaluate.js";
import { groupName } from "../wire/groups.js";
import { HandshakeObserver, type Observation } from "../wire/observer.js";
import { TapDuplex } from "../wire/tap.js";
import { signAssertion } from "./assertion.js";
import { verifyClientCertificate } from "./client-cert.js";
import type { ConnectionEventPayload, EventSink, SidecarConfigPayload, SidecarCounters } from "./types.js";

export interface SidecarOptions {
  host: string;
  port: number;
  tls: { keyPem: string; certPem: string; peerCaPem: string };
  upstreamUrl: URL;
  assertionSecret: string;
  instanceId: string;
  events: EventSink;
  logger: Logger;
  /** Only requests whose path matches one of these are forwarded to the core. */
  routeAllowList?: RegExp[];
  maxConnections?: number;
  handshakeTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxBodyBytes?: number;
  upstreamTimeoutMs?: number;
}

interface ActiveConfig {
  version: number;
  profileName: string;
  groups: string[];
  secureContext: tls.SecureContext;
  peersBySha256: Map<string, PeerRecord>;
  appliedAt: Date;
}

interface ConnectionContext {
  correlationId: string;
  outcome: PolicyOutcome;
  keyExchange: "hybrid" | "classical" | "unknown";
  negotiatedGroup: string | null;
  configVersion: number;
  remoteAddr: string | undefined;
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"]);
const STRIP_FROM_PEER = /^(x-pqc-|x-sidecar-|x-forwarded-|authorization$|cookie$|x-request-id$)/i;

function normalizeAddress(addr: string | undefined): string | undefined {
  return addr?.replace(/^::ffff:/, "");
}

const emptyCounters = (): SidecarCounters => ({
  connectionsAccepted: 0,
  connectionsRefusedOverLimit: 0,
  handshakesCompleted: 0,
  handshakesFailed: 0,
  decisions: {},
  requestsForwarded: 0,
  requestsRejected: 0,
  upstreamErrors: 0,
  eventsSuppressed: 0,
  configsApplied: 0,
  configsRejected: 0,
});

/**
 * The perimeter sidecar: a TLS 1.3-only listener that
 *  1. negotiates the key-agreement groups the active profile allows (hybrid X25519MLKEM768
 *     and/or classical X25519) using the TLS library's own implementation,
 *  2. verifies from the wire which group was actually negotiated (HandshakeObserver),
 *  3. identifies the peer by client-certificate fingerprint and applies its fallback policy,
 *  4. records every decision as a telemetry event, and
 *  5. forwards only allow-listed requests of accepted peers to the core, with a signed
 *     peer assertion. Post-quantum protection ends here: the hop to the core is plain HTTP.
 */
export class Sidecar {
  private readonly counters = emptyCounters();
  private readonly contexts = new WeakMap<object, ConnectionContext>();
  private readonly peerCa: X509Certificate;
  private readonly httpServer: http.Server;
  private readonly netServer: net.Server;
  private active: ActiveConfig | undefined;
  private openConnections = 0;
  private readonly startedAt = new Date();
  private bucketTokens = 200;
  private bucketUpdated = Date.now();

  private readonly routeAllowList: RegExp[];
  private readonly maxConnections: number;
  private readonly handshakeTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly upstreamTimeoutMs: number;

  constructor(private readonly opts: SidecarOptions) {
    this.peerCa = new X509Certificate(opts.tls.peerCaPem);
    this.routeAllowList = opts.routeAllowList ?? [/^\/partner\/v1\/[A-Za-z0-9/_-]*(\?.*)?$/];
    this.maxConnections = opts.maxConnections ?? 200;
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? 10_000;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 30_000;
    this.maxBodyBytes = opts.maxBodyBytes ?? 64 * 1024;
    this.upstreamTimeoutMs = opts.upstreamTimeoutMs ?? 10_000;

    this.httpServer = http.createServer({ keepAliveTimeout: 5_000, maxHeaderSize: 8 * 1024 }, (req, res) => this.handleRequest(req, res));
    // Slow-client protection (slowloris): bound how long headers and a whole request may take.
    this.httpServer.headersTimeout = 10_000;
    this.httpServer.requestTimeout = 15_000;
    this.httpServer.on("clientError", (_err, socket) => socket.destroy());
    this.netServer = net.createServer((raw) => this.onConnection(raw));
  }

  /** Applies a configuration snapshot to NEW connections. Existing connections keep what they
   *  negotiated. Returns false (and keeps the previous configuration) if it cannot be applied. */
  applyConfig(cfg: SidecarConfigPayload): { applied: boolean; error?: string } {
    try {
      const secureContext = tls.createSecureContext({
        key: this.opts.tls.keyPem,
        cert: this.opts.tls.certPem,
        ca: this.opts.tls.peerCaPem,
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
        ecdhCurve: cfg.tlsProfile.groups.join(":"),
      });
      this.active = {
        version: cfg.version,
        profileName: cfg.tlsProfile.name,
        groups: [...cfg.tlsProfile.groups],
        secureContext,
        peersBySha256: new Map(cfg.peers.map((p) => [p.certSha256, p])),
        appliedAt: new Date(),
      };
      this.counters.configsApplied += 1;
      this.opts.logger.info({ configVersion: cfg.version, profile: cfg.tlsProfile.name, groups: cfg.tlsProfile.groups, peers: cfg.peers.length }, "configuration applied");
      return { applied: true };
    } catch (err) {
      this.counters.configsRejected += 1;
      const message = (err as Error).message;
      this.opts.logger.error({ configVersion: cfg.version, error: message }, "configuration rejected; keeping previous configuration");
      return { applied: false, error: message };
    }
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.netServer.once("error", reject);
      this.netServer.listen(this.opts.port, this.opts.host, () => {
        this.netServer.off("error", reject);
        resolve();
      });
    });
    const port = (this.netServer.address() as net.AddressInfo).port;
    this.opts.logger.info({ host: this.opts.host, port, minVersion: "TLSv1.3" }, "sidecar listening");
    return port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.netServer.close(() => resolve()));
    this.httpServer.closeAllConnections();
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
  }

  get port(): number {
    return (this.netServer.address() as net.AddressInfo | null)?.port ?? this.opts.port;
  }

  status() {
    return {
      instanceId: this.opts.instanceId,
      startedAt: this.startedAt.toISOString(),
      ready: this.active !== undefined,
      appliedConfigVersion: this.active?.version ?? null,
      activeProfile: this.active?.profileName ?? null,
      groups: this.active?.groups ?? [],
      configAppliedAt: this.active?.appliedAt.toISOString() ?? null,
      openConnections: this.openConnections,
      counters: { ...this.counters, decisions: { ...this.counters.decisions } },
    };
  }

  private takeEventToken(): boolean {
    const now = Date.now();
    this.bucketTokens = Math.min(200, this.bucketTokens + ((now - this.bucketUpdated) / 1000) * 100);
    this.bucketUpdated = now;
    if (this.bucketTokens < 1) return false;
    this.bucketTokens -= 1;
    return true;
  }

  private record(event: ConnectionEventPayload): void {
    this.counters.decisions[event.decision] = (this.counters.decisions[event.decision] ?? 0) + 1;
    // Bound telemetry volume so a flood of junk handshakes cannot flood the control plane.
    if (event.decision === "handshake-failed" && !this.takeEventToken()) {
      this.counters.eventsSuppressed += 1;
      return;
    }
    this.opts.events.emit(event);
  }

  private onConnection(raw: net.Socket): void {
    const active = this.active;
    if (!active || this.openConnections >= this.maxConnections) {
      // Fail closed: with no configuration there is no policy to apply, so accept nothing.
      if (active) this.counters.connectionsRefusedOverLimit += 1;
      raw.destroy();
      return;
    }
    this.counters.connectionsAccepted += 1;
    this.openConnections += 1;
    raw.once("close", () => {
      this.openConnections -= 1;
    });
    raw.setNoDelay(true);

    const startedAt = performance.now();
    const correlationId = randomUUID();
    const observer = new HandshakeObserver();
    const tap = new TapDuplex(raw, observer, "server");
    const remoteAddr = normalizeAddress(raw.remoteAddress);
    const socket = new tls.TLSSocket(tap, {
      isServer: true,
      secureContext: active.secureContext,
      requestCert: true,
      // Verification outcome is evaluated by the policy, so an untrusted or missing certificate
      // is logged as a decision instead of a bare TLS alert.
      rejectUnauthorized: false,
    });

    let settled = false;
    const timer = setTimeout(() => fail("handshake timed out"), this.handshakeTimeoutMs);
    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const obs = observer.observation;
      raw.destroy();
      // A connection that never sent a byte (port probe, health check) is not a handshake attempt.
      if (tap.bytesIn === 0) return;
      this.counters.handshakesFailed += 1;
      this.record(this.failureEvent(active, obs, correlationId, remoteAddr, reason, performance.now() - startedAt));
    };

    socket.once("secure", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.counters.handshakesCompleted += 1;
      this.onSecure(socket, observer.observation, active, correlationId, remoteAddr, performance.now() - startedAt);
    });
    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (!settled) fail(`TLS handshake failed: ${err.code ?? err.message}`);
      else this.opts.logger.debug({ correlationId, error: err.message }, "connection error after handshake");
    });
    socket.once("close", () => {
      if (!settled) fail("connection closed before the handshake completed");
    });
  }

  private failureEvent(active: ActiveConfig, obs: Observation, correlationId: string, remoteAddr: string | undefined, reason: string, ms: number): ConnectionEventPayload {
    const serverAlert = obs.alerts.find((a) => a.from === "server");
    return {
      id: randomUUID(),
      correlationId,
      occurredAt: new Date().toISOString(),
      ...(remoteAddr ? { remoteAddr } : {}),
      offeredGroups: (obs.clientHello?.offeredGroups ?? []).map((code) => ({ code, ...(groupName(code) ? { name: groupName(code)! } : {}) })),
      keyExchange: "unknown",
      decision: "handshake-failed",
      reason: `${reason}${serverAlert ? ` (server alert ${serverAlert.description})` : ""}${obs.notTls ? " (not a TLS ClientHello)" : ""}`.slice(0, 300),
      handshakeMs: Math.round(ms * 1000) / 1000,
      configVersion: active.version,
    };
  }

  private onSecure(socket: tls.TLSSocket, obs: Observation, active: ActiveConfig, correlationId: string, remoteAddr: string | undefined, handshakeMs: number): void {
    const cert = verifyClientCertificate(socket, this.peerCa);
    const sha256 = cert.sha256;
    const group = obs.serverHello?.selectedGroup;
    const { keyExchange, name } = classifyKeyExchange(group);
    const outcome = evaluatePolicy({
      peersBySha256: active.peersBySha256,
      certificate: { presented: cert.presented, trusted: cert.trusted, sha256 },
      keyExchange,
    });

    const clientShare = group === undefined ? undefined : obs.clientHello?.keyShares.find((k) => k.group === group)?.bytes;
    const event: ConnectionEventPayload = {
      id: randomUUID(),
      correlationId,
      occurredAt: new Date().toISOString(),
      ...(remoteAddr ? { remoteAddr } : {}),
      ...(outcome.peer ? { peerId: outcome.peer.id, peerName: outcome.peer.name, expectedProfile: outcome.peer.profile } : {}),
      ...(sha256 ? { certSha256: sha256 } : {}),
      ...(socket.getProtocol() ? { tlsVersion: socket.getProtocol()! } : {}),
      ...(socket.getCipher()?.name ? { cipher: socket.getCipher().name } : {}),
      offeredGroups: (obs.clientHello?.offeredGroups ?? []).map((code) => ({ code, ...(groupName(code) ? { name: groupName(code)! } : {}) })),
      ...(name ? { negotiatedGroup: name } : {}),
      ...(group !== undefined ? { negotiatedGroupCode: group } : {}),
      keyExchange,
      ...(clientShare !== undefined ? { clientKeyShareBytes: clientShare } : {}),
      ...(obs.serverHello?.keyShareBytes !== undefined ? { serverKeyShareBytes: obs.serverHello.keyShareBytes } : {}),
      decision: outcome.decision,
      reason: outcome.reason.slice(0, 300),
      handshakeMs: Math.round(handshakeMs * 1000) / 1000,
      configVersion: active.version,
    };
    this.record(event);
    this.opts.logger.info(
      { correlationId, peer: outcome.peer?.name ?? null, decision: outcome.decision, group: name ?? null, keyExchange, configVersion: active.version },
      "connection evaluated",
    );

    if (!outcome.allowed) {
      this.reject(socket, outcome, correlationId);
      return;
    }
    socket.setTimeout(this.idleTimeoutMs, () => socket.destroy());
    this.contexts.set(socket, { correlationId, outcome, keyExchange, negotiatedGroup: name ?? null, configVersion: active.version, remoteAddr });
    this.httpServer.emit("connection", socket);
  }

  /** Tells the peer why, then closes. The body is deliberately generic: it must not reveal what
   *  is (or is not) in the peer registry. */
  private reject(socket: tls.TLSSocket, outcome: PolicyOutcome, correlationId: string): void {
    const violation = outcome.decision === "rejected-violation";
    const body = JSON.stringify({
      error: {
        code: violation ? "POLICY_VIOLATION" : "PEER_NOT_AUTHORIZED",
        message: violation ? "The negotiated TLS key agreement does not satisfy this peer's policy." : "This peer is not authorized.",
        correlationId,
      },
    });
    socket.end(
      `HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\nx-pqc-correlation-id: ${correlationId}\r\n\r\n${body}`,
    );
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown, correlationId?: string): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(text),
      ...(correlationId ? { "x-pqc-correlation-id": correlationId } : {}),
    });
    res.end(text);
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const ctx = this.contexts.get(req.socket);
    if (!ctx) {
      this.counters.requestsRejected += 1;
      this.sendJson(res, 500, { error: { code: "NO_CONNECTION_CONTEXT", message: "Internal error" } });
      return;
    }
    const url = req.url ?? "/";

    // Lets a peer see exactly what the sidecar observed and decided about its connection.
    if (req.method === "GET" && url === "/sidecar/whoami") {
      this.sendJson(
        res,
        200,
        {
          peer: ctx.outcome.peer ? { id: ctx.outcome.peer.id, name: ctx.outcome.peer.name, profile: ctx.outcome.peer.profile } : null,
          decision: ctx.outcome.decision,
          keyExchange: ctx.keyExchange,
          negotiatedGroup: ctx.negotiatedGroup,
          configVersion: ctx.configVersion,
          correlationId: ctx.correlationId,
          note: "Post-quantum protection of key establishment applies to this TLS connection only. The hop from the sidecar to the core is plain HTTP.",
        },
        ctx.correlationId,
      );
      return;
    }

    if (!this.routeAllowList.some((re) => re.test(url))) {
      this.counters.requestsRejected += 1;
      this.sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Route not exposed through the sidecar", correlationId: ctx.correlationId } }, ctx.correlationId);
      return;
    }
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > this.maxBodyBytes) {
      this.counters.requestsRejected += 1;
      this.sendJson(res, 413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large", correlationId: ctx.correlationId } }, ctx.correlationId);
      req.destroy();
      return;
    }
    this.forward(req, res, ctx);
  }

  private forward(req: http.IncomingMessage, res: http.ServerResponse, ctx: ConnectionContext): void {
    const peer = ctx.outcome.peer!;
    const path = req.url ?? "/";
    const method = req.method ?? "GET";

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase();
      if (HOP_BY_HOP.has(lower) || STRIP_FROM_PEER.test(lower) || value === undefined) continue;
      headers[lower] = Array.isArray(value) ? value.join(", ") : value;
    }
    headers["x-request-id"] = ctx.correlationId;
    headers["x-sidecar-assertion"] = signAssertion(
      {
        v: 2,
        peerId: peer.id,
        peerName: peer.name,
        keyExchange: ctx.keyExchange,
        negotiatedGroup: ctx.negotiatedGroup,
        decision: ctx.outcome.decision,
        correlationId: ctx.correlationId,
        iat: Math.floor(Date.now() / 1000),
        jti: randomUUID(),
        method,
        path,
      },
      this.opts.assertionSecret,
    );

    const target = new URL(path, this.opts.upstreamUrl);
    const client = target.protocol === "https:" ? https : http;
    let received = 0;
    let finished = false;

    const upstream = client.request(target, { method, headers, timeout: this.upstreamTimeoutMs }, (upstreamRes) => {
      const out: http.OutgoingHttpHeaders = { "x-pqc-correlation-id": ctx.correlationId };
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (!HOP_BY_HOP.has(name.toLowerCase()) && value !== undefined) out[name] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, out);
      upstreamRes.pipe(res);
      upstreamRes.on("end", () => {
        finished = true;
        this.counters.requestsForwarded += 1;
      });
    });
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", (err) => {
      this.counters.upstreamErrors += 1;
      this.opts.logger.warn({ correlationId: ctx.correlationId, error: err.message }, "upstream error");
      if (!res.headersSent) this.sendJson(res, 502, { error: { code: "UPSTREAM_UNAVAILABLE", message: "The core service is unavailable", correlationId: ctx.correlationId } }, ctx.correlationId);
      else res.destroy();
    });
    res.on("close", () => {
      if (!finished) upstream.destroy();
    });

    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > this.maxBodyBytes) {
        this.counters.requestsRejected += 1;
        upstream.destroy();
        if (!res.headersSent) this.sendJson(res, 413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large", correlationId: ctx.correlationId } }, ctx.correlationId);
        req.destroy();
      }
    });
    req.pipe(upstream);
  }
}
