export interface PartnerProvenance {
  peerName: string;
  keyExchange: "hybrid" | "classical" | "unknown";
  negotiatedGroup: string | null;
}

const KEY_EXCHANGES = new Set(["hybrid", "classical", "unknown"]);

/**
 * Reads the server-attested provenance the core stored with a transaction that arrived through the
 * partner API: which peer sent it and which key exchange the sidecar verified on that TLS
 * connection. Returns null for anything else, and never trusts shapes it does not recognise.
 */
export function partnerProvenance(metadata: Record<string, unknown> | undefined): PartnerProvenance | null {
  const context = metadata?.["context"];
  if (!context || typeof context !== "object") return null;
  const c = context as { channel?: unknown; peer?: { name?: unknown }; tls?: { keyExchange?: unknown; negotiatedGroup?: unknown } };
  if (c.channel !== "partner") return null;
  const peerName = c.peer?.name;
  const keyExchange = c.tls?.keyExchange;
  if (typeof peerName !== "string" || typeof keyExchange !== "string" || !KEY_EXCHANGES.has(keyExchange)) return null;
  const group = c.tls?.negotiatedGroup;
  return { peerName, keyExchange: keyExchange as PartnerProvenance["keyExchange"], negotiatedGroup: typeof group === "string" ? group : null };
}

export function describeProvenance(p: PartnerProvenance): { label: string; tone: "success" | "warning" | "neutral"; explanation: string } {
  const base =
    "Key establishment of the TLS connection that delivered this payment to the bank, as verified by the sidecar. It says nothing about protection beyond that connection: the hop to the core is plain HTTP and certificates are classical.";
  if (p.keyExchange === "hybrid") {
    return { label: `${p.peerName} · hybrid key exchange`, tone: "success", explanation: `${base} Negotiated group: ${p.negotiatedGroup ?? "unknown"}.` };
  }
  if (p.keyExchange === "classical") {
    return {
      label: `${p.peerName} · classical key exchange (fallback)`,
      tone: "warning",
      explanation: `${base} This peer is explicitly allowed to fall back to ${p.negotiatedGroup ?? "a classical group"}, which has no post-quantum key-establishment protection.`,
    };
  }
  return { label: `${p.peerName} · key exchange unverified`, tone: "neutral", explanation: base };
}
