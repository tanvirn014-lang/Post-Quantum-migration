/**
 * Registry of the TLS key-agreement groups and crypto providers this prototype knows about.
 * It is an allow-list: a profile can only reference groups listed here, and only a provider
 * marked `selectable` can be used. Entries describe capability; whether a provider actually
 * negotiates a group is established by verified handshake telemetry, not by this table.
 */

export type GroupKind = "hybrid" | "classical";

export interface TlsGroup {
  name: string;
  /** IANA TLS supported-group code point. */
  code: number;
  kind: GroupKind;
  description: string;
}

export const TLS_GROUPS: Readonly<Record<string, TlsGroup>> = {
  X25519MLKEM768: {
    name: "X25519MLKEM768",
    code: 0x11ec,
    kind: "hybrid",
    description: "Hybrid X25519 + ML-KEM-768 key agreement (RFC 10024). Client share 1216 bytes, server share 1120 bytes.",
  },
  X25519: {
    name: "X25519",
    code: 0x001d,
    kind: "classical",
    description: "X25519 elliptic-curve Diffie-Hellman (RFC 7748). Classical; no post-quantum protection.",
  },
};

export function groupByCode(code: number): TlsGroup | undefined {
  return Object.values(TLS_GROUPS).find((g) => g.code === code);
}

export type ProviderStatus = "LIVE" | "PLANNED";

export interface CryptoProvider {
  id: string;
  name: string;
  library: string;
  status: ProviderStatus;
  /** Only selectable providers may appear in a profile that the sidecar will enforce. */
  selectable: boolean;
  supportedGroups: readonly string[];
  notes: string;
}

export const CRYPTO_PROVIDERS: readonly CryptoProvider[] = [
  {
    id: "node-openssl",
    name: "Node.js TLS (OpenSSL)",
    library: "OpenSSL via node:tls",
    status: "LIVE",
    selectable: true,
    supportedGroups: ["X25519MLKEM768", "X25519"],
    notes:
      "Used by the sidecar. Selects the permitted key-agreement groups for new connections; the library itself performs the handshake. The negotiated group is verified from the ServerHello on the wire because node:tls does not expose it for hybrid groups.",
  },
  {
    id: "bcjsse-java",
    name: "Bouncy Castle BCJSSE (Java)",
    library: "Bouncy Castle JSSE provider",
    status: "PLANNED",
    selectable: false,
    supportedGroups: [],
    notes: "Named in the proposal as a planned implementation choice. Not implemented in this prototype; never selectable.",
  },
];

export const DEFAULT_PROVIDER_ID = "node-openssl";

/** Returns human-readable problems; empty means the group list is acceptable for the provider. */
export function validateProfileGroups(groups: readonly string[], providerId = DEFAULT_PROVIDER_ID): string[] {
  const problems: string[] = [];
  const provider = CRYPTO_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return [`unknown provider ${providerId}`];
  if (!provider.selectable) problems.push(`provider ${provider.id} is not selectable (${provider.status})`);
  if (groups.length < 1 || groups.length > 4) problems.push("a profile needs between 1 and 4 groups");
  if (new Set(groups).size !== groups.length) problems.push("groups must not repeat");
  for (const g of groups) {
    if (!TLS_GROUPS[g]) problems.push(`group ${g} is not in the registry`);
    else if (!provider.supportedGroups.includes(g)) problems.push(`provider ${provider.id} does not support ${g}`);
  }
  return problems;
}

export interface ProfileSummary {
  offersHybrid: boolean;
  allowsClassical: boolean;
  /** One honest sentence about what the profile can and cannot protect. */
  summary: string;
}

export function summarizeProfile(groups: readonly string[]): ProfileSummary {
  const kinds = groups.map((g) => TLS_GROUPS[g]?.kind);
  const offersHybrid = kinds.includes("hybrid");
  const allowsClassical = kinds.includes("classical");
  const summary = !offersHybrid
    ? "Classical only: no post-quantum key-establishment protection on any connection."
    : allowsClassical
      ? "Hybrid is used with capable peers; classical clients can still connect, and those sessions have no post-quantum key-establishment protection."
      : "Hybrid only: every accepted connection used hybrid key establishment; classical-only clients cannot connect.";
  return { offersHybrid, allowsClassical, summary };
}
