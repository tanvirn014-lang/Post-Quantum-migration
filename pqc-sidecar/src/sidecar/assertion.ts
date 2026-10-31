import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * What the sidecar vouches for to the core about one forwarded request. The core accepts
 * partner traffic only with a valid assertion, so a caller that bypasses the sidecar cannot
 * claim a peer identity or a negotiated group. Plain HMAC-SHA256 over a shared secret - this
 * is service authentication on a private network, not a post-quantum construction.
 */
export interface PeerAssertion {
  v: 1;
  peerId: string;
  peerName: string;
  keyExchange: "hybrid" | "classical" | "unknown";
  negotiatedGroup: string | null;
  decision: string;
  correlationId: string;
  /** Unix seconds when signed. */
  iat: number;
  method: string;
  path: string;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function signAssertion(payload: PeerAssertion, secret: string): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(createHmac("sha256", secret).update(body).digest())}`;
}

export interface VerifyOptions {
  now?: number;
  maxAgeSeconds?: number;
  method?: string;
  path?: string;
}

/** Returns the payload only if signature, freshness and (optionally) method/path all match. */
export function verifyAssertion(token: string, secret: string, opts: VerifyOptions = {}): PeerAssertion | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: PeerAssertion;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PeerAssertion;
  } catch {
    return null;
  }
  if (payload.v !== 1 || typeof payload.iat !== "number") return null;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.iat) > (opts.maxAgeSeconds ?? 30)) return null;
  if (opts.method !== undefined && payload.method !== opts.method) return null;
  if (opts.path !== undefined && payload.path !== opts.path) return null;
  return payload;
}
