import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { createHash } from "node:crypto";

/**
 * Internal mutual TLS for the sidecar↔core hop. The external peer→sidecar boundary already uses
 * hybrid TLS; this closes the previously plain-HTTP internal hop with CLASSICAL mutual TLS (ECDSA
 * certs from the internal dev PKI) plus a revocation deny-list. TLS 1.3 is pinned on both ends.
 *
 * Protection level: transport confidentiality + mutual authentication are CLASSICAL here (the
 * certificates are ECDSA P-256). Post-quantum key establishment exists only at the external
 * peer→sidecar boundary; this hop is defence-in-depth for the private network, not PQ-protected.
 */
export interface MtlsServerOptions {
  serverCertPem: string;
  serverKeyPem: string;
  /** CA that must have issued the client (sidecar) certificate. */
  clientCaPem: string;
  /** Returns true if a presented client certificate's SHA-256 fingerprint is revoked. */
  isRevoked?: (fingerprintSha256: string) => boolean;
}

export function peerFingerprint(socket: TLSSocket): string | null {
  const cert = socket.getPeerCertificate();
  if (!cert || !cert.raw) return null;
  return createHash("sha256").update(cert.raw).digest("hex");
}

/** An HTTPS server that REQUIRES a client certificate chaining to `clientCaPem` (Node rejects
 *  anything else at the handshake) and additionally refuses revoked fingerprints at the request. */
export function createInternalMtlsServer(
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
  opts: MtlsServerOptions,
): https.Server {
  return https.createServer(
    {
      cert: opts.serverCertPem,
      key: opts.serverKeyPem,
      ca: opts.clientCaPem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
    },
    (req, res) => {
      const fp = peerFingerprint(req.socket as TLSSocket);
      if (opts.isRevoked && fp && opts.isRevoked(fp)) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "CLIENT_CERT_REVOKED", message: "client certificate is revoked" } }));
        return;
      }
      onRequest(req, res);
    },
  );
}

export interface MtlsClientOptions {
  clientCertPem: string;
  clientKeyPem: string;
  /** CA that must have issued the server (core) certificate. */
  serverCaPem: string;
}

/** An HTTPS agent that presents the sidecar's client certificate and pins the server CA. Attach it
 *  to the sidecar's upstream request when forwarding to an https core. */
export function internalMtlsAgent(opts: MtlsClientOptions): https.Agent {
  return new https.Agent({
    cert: opts.clientCertPem,
    key: opts.clientKeyPem,
    ca: opts.serverCaPem,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    keepAlive: false,
  });
}
