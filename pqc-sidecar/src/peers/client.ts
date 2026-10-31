import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { performance } from "node:perf_hooks";
import { HandshakeObserver, type Observation } from "../wire/observer.js";
import { TapDuplex } from "../wire/tap.js";

/**
 * OpenSSL group lists for the simulated peers. The `*` prefix makes OpenSSL send a key share for
 * that group (as browsers do); without it only the FIRST group gets a key share.
 */
export const HYBRID_CAPABLE_GROUPS = "*X25519MLKEM768:*X25519";
export const CLASSICAL_ONLY_GROUPS = "X25519";

export interface PeerRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface PeerConnectOptions {
  host: string;
  port: number;
  servername?: string;
  /** PEM of the CA that issued the sidecar's server certificate. */
  caPem: string;
  /** Client certificate; omit to connect without one. */
  identity?: { keyPem: string; certPem: string };
  /** OpenSSL group list the client offers. */
  groups: string;
  request?: PeerRequest;
  timeoutMs?: number;
}

export interface PeerResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: unknown;
}

export interface PeerConnectResult {
  connected: boolean;
  /** Time from starting the TLS handshake (TCP already connected) to completion. */
  handshakeMs: number | null;
  error?: string;
  protocol?: string | undefined;
  cipher?: string | undefined;
  /** What the client saw on the wire (its own ClientHello and the server's ServerHello). */
  observation: Observation;
  /** Wire bytes exchanged up to handshake completion, both directions. */
  handshakeBytes: { sent: number; received: number } | null;
  response?: PeerResponse;
}

function describeError(err: Error): string {
  const code = (err as NodeJS.ErrnoException).code;
  return code ? `${code}: ${err.message.split("\n")[0]}` : err.message.split("\n")[0]!;
}

/**
 * One simulated external peer connection: a real TLS 1.3 handshake, optionally followed by one
 * HTTP request, with the handshake observed on the wire from the client side.
 */
export async function connectAsPeer(opts: PeerConnectOptions): Promise<PeerConnectResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const observer = new HandshakeObserver();
  const empty = (): PeerConnectResult => ({ connected: false, handshakeMs: null, observation: observer.observation, handshakeBytes: null });

  let raw: net.Socket;
  try {
    raw = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(opts.port, opts.host);
      s.setNoDelay(true);
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
  } catch (err) {
    return { ...empty(), error: describeError(err as Error) };
  }
  raw.on("error", () => {});

  const tap = new TapDuplex(raw, observer, "client");
  const startedAt = performance.now();

  return new Promise<PeerConnectResult>((resolve) => {
    let done = false;
    const finish = (result: PeerConnectResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      raw.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ...empty(), error: "timed out" }), timeoutMs);

    const socket = tls.connect({
      socket: tap,
      servername: opts.servername ?? "localhost",
      ca: opts.caPem,
      minVersion: "TLSv1.3",
      ecdhCurve: opts.groups,
      ...(opts.identity ? { key: opts.identity.keyPem, cert: opts.identity.certPem } : {}),
    });
    socket.on("error", (err) => finish({ ...empty(), error: describeError(err) }));
    socket.on("close", () => finish({ ...empty(), error: "connection closed" }));

    socket.once("secureConnect", () => {
      const handshakeMs = performance.now() - startedAt;
      const base: PeerConnectResult = {
        connected: true,
        handshakeMs,
        protocol: socket.getProtocol() ?? undefined,
        cipher: socket.getCipher()?.name,
        observation: observer.observation,
        handshakeBytes: { sent: tap.bytesOut, received: tap.bytesIn },
      };
      if (!opts.request) {
        finish(base);
        return;
      }
      const req = http.request({
        // No agent: with an agent Node ignores createConnection and would dial port 80 itself.
        createConnection: () => socket,
        host: opts.servername ?? "localhost",
        method: opts.request.method,
        path: opts.request.path,
        headers: { connection: "close", ...(opts.request.body ? { "content-length": String(Buffer.byteLength(opts.request.body)) } : {}), ...(opts.request.headers ?? {}) },
      });
      req.on("response", (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json: unknown;
          try {
            json = JSON.parse(body);
          } catch {
            json = undefined;
          }
          const headers = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]));
          finish({ ...base, observation: observer.observation, response: { status: res.statusCode ?? 0, headers, body, json } });
        });
      });
      req.on("error", (err) => finish({ ...base, observation: observer.observation, error: describeError(err) }));
      req.end(opts.request.body);
    });
  });
}
