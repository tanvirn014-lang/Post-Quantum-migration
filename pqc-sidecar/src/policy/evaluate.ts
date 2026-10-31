import { lookupGroup } from "../wire/groups.js";

export type PeerProfile = "hybrid-required" | "classical-allowed";
export type KeyExchange = "hybrid" | "classical" | "unknown";
export type Decision = "allowed-hybrid" | "allowed-fallback" | "rejected-violation" | "rejected-unknown-peer" | "handshake-failed";

export interface PeerRecord {
  id: string;
  name: string;
  /** SHA-256 of the peer's client certificate, lowercase hex. This is the peer's identity. */
  certSha256: string;
  profile: PeerProfile;
  enabled: boolean;
}

export interface ClientCertificate {
  presented: boolean;
  /** Verified against the configured peer CA (see verifyClientCertificate). */
  trusted: boolean;
  sha256: string | undefined;
}

export interface PolicyOutcome {
  decision: Decision;
  reason: string;
  /** The registered peer, when the certificate identified one. */
  peer: PeerRecord | null;
  allowed: boolean;
}

/** Maps the group the ServerHello selected to the key-exchange class the policy reasons about. */
export function classifyKeyExchange(selectedGroup: number | undefined): { keyExchange: KeyExchange; name: string | undefined } {
  if (selectedGroup === undefined) return { keyExchange: "unknown", name: undefined };
  const known = lookupGroup(selectedGroup);
  if (!known) return { keyExchange: "unknown", name: undefined };
  return { keyExchange: known.kind, name: known.name };
}

/**
 * The per-peer fallback policy (proposal 8.2). Identity comes only from a client certificate
 * that chains to the trusted peer CA AND whose fingerprint is registered - never from a network
 * address. Every connection ends in exactly one decision, so an unclassified classical
 * negotiation cannot occur (hypothesis H3): classical on a classical-allowed peer is an
 * explicitly labelled fallback; classical on a hybrid-required peer is rejected.
 */
export function evaluatePolicy(input: {
  peersBySha256: ReadonlyMap<string, PeerRecord>;
  certificate: ClientCertificate;
  keyExchange: KeyExchange;
}): PolicyOutcome {
  const { certificate, keyExchange } = input;

  if (!certificate.presented) {
    return { decision: "rejected-unknown-peer", reason: "no client certificate presented", peer: null, allowed: false };
  }
  if (!certificate.trusted) {
    return { decision: "rejected-unknown-peer", reason: "client certificate is not issued by the trusted peer CA", peer: null, allowed: false };
  }
  const peer = certificate.sha256 ? (input.peersBySha256.get(certificate.sha256) ?? null) : null;
  if (!peer) {
    return { decision: "rejected-unknown-peer", reason: "certificate fingerprint is not registered (unknown peers are denied by default)", peer: null, allowed: false };
  }
  if (!peer.enabled) {
    return { decision: "rejected-unknown-peer", reason: `peer ${peer.name} is disabled`, peer, allowed: false };
  }

  if (keyExchange === "hybrid") {
    return { decision: "allowed-hybrid", reason: "hybrid key agreement negotiated", peer, allowed: true };
  }
  if (keyExchange === "classical") {
    if (peer.profile === "classical-allowed") {
      return {
        decision: "allowed-fallback",
        reason: "classical key agreement negotiated; permitted by this peer's classical-allowed profile (no post-quantum key-establishment protection)",
        peer,
        allowed: true,
      };
    }
    return { decision: "rejected-violation", reason: "classical key agreement negotiated by a hybrid-required peer", peer, allowed: false };
  }
  return { decision: "rejected-violation", reason: "the negotiated group could not be verified from the handshake", peer, allowed: false };
}
