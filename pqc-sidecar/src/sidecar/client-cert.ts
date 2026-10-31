import { X509Certificate } from "node:crypto";
import type tls from "node:tls";

const EKU_CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";

export interface ClientCertVerdict {
  presented: boolean;
  trusted: boolean;
  /** Lowercase hex SHA-256 of the DER certificate. */
  sha256: string | undefined;
  /** Why the certificate is not trusted, for telemetry. */
  problem: string | undefined;
}

interface HandleWithVerify {
  _handle?: { verifyError?: () => { code?: string } | null | undefined };
}

/**
 * Decides whether a client certificate is trusted. A manually constructed server TLSSocket
 * (needed to tap the handshake) does not get `socket.authorized` set by Node - only `tls.Server`
 * wires that - so verification is explicit and layered:
 *  1. OpenSSL's own chain verdict from the handshake, when the runtime exposes it, and
 *  2. independent checks with node:crypto's X509Certificate: issued by the configured peer CA,
 *     signature verifies under the CA key, inside its validity window, and (if the certificate
 *     declares extended key usage) permitted for client authentication.
 * The certificate is trusted only if every check passes. There is no revocation checking and
 * the trust anchor is a single CA - documented prototype limits.
 */
export function verifyClientCertificate(socket: tls.TLSSocket, ca: X509Certificate, now = new Date()): ClientCertVerdict {
  const peer = socket.getPeerCertificate(false);
  const raw = peer && Object.keys(peer).length > 0 ? peer.raw : undefined;
  if (!raw) return { presented: false, trusted: false, sha256: undefined, problem: "no client certificate presented" };

  let leaf: X509Certificate;
  try {
    leaf = new X509Certificate(raw);
  } catch {
    return { presented: true, trusted: false, sha256: undefined, problem: "client certificate could not be parsed" };
  }
  const sha256 = leaf.fingerprint256.replace(/:/g, "").toLowerCase();
  const fail = (problem: string): ClientCertVerdict => ({ presented: true, trusted: false, sha256, problem });

  const verifyError = (socket as unknown as HandleWithVerify)._handle?.verifyError?.();
  if (verifyError) return fail(`TLS stack rejected the chain (${verifyError.code ?? "unknown"})`);

  if (!leaf.checkIssued(ca) || !leaf.verify(ca.publicKey)) return fail("not issued by the trusted peer CA");
  if (now < new Date(leaf.validFrom) || now > new Date(leaf.validTo)) return fail("certificate is outside its validity period");
  const usage = leaf.keyUsage;
  if (usage && usage.length > 0 && !usage.includes(EKU_CLIENT_AUTH)) return fail("certificate is not valid for client authentication");

  return { presented: true, trusted: true, sha256, problem: undefined };
}
