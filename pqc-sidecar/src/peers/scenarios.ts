import { randomUUID } from "node:crypto";
import { GROUP_X25519_MLKEM768, groupName } from "../wire/groups.js";
import { CLASSICAL_ONLY_GROUPS, HYBRID_CAPABLE_GROUPS, connectAsPeer, type PeerConnectResult } from "./client.js";
import { startTamperProxy } from "./tamper-proxy.js";

export interface PeerIdentityMaterial {
  keyPem: string;
  certPem: string;
}

/** Optional inputs for the payment scenarios, which pay a real account through the sidecar and core. */
export interface ScenarioParams {
  toAccountId?: string | undefined;
  amountMinorUnits?: string | undefined;
  reference?: string | undefined;
}

export class ScenarioInputError extends Error {}

export interface ScenarioContext {
  params?: ScenarioParams;
  host: string;
  port: number;
  /** CA that signed the sidecar's server certificate. */
  caPem: string;
  identities: {
    hybridBank: PeerIdentityMaterial;
    legacyPsp: PeerIdentityMaterial;
    strictBank: PeerIdentityMaterial;
    unregistered: PeerIdentityMaterial;
    rogue: PeerIdentityMaterial;
  };
}

export type Outcome =
  | "allowed-hybrid"
  | "allowed-fallback"
  | "rejected-violation"
  | "rejected-unknown-peer"
  | "handshake-failed"
  | "unexpected";

export interface ScenarioDefinition {
  id: string;
  title: string;
  /** Which experiment of proposal section 11.1 this exercises. */
  experiment: "B" | "C" | "E2E";
  description: string;
  /** Parameters the caller must supply. */
  requires?: (keyof ScenarioParams)[];
  /** What the sidecar is expected to decide under the default (hybrid-preferred) profile. */
  expected: Outcome;
  /** Outcomes that are also correct if the active TLS profile has been changed. */
  alsoAcceptable?: Outcome[];
  run(ctx: ScenarioContext): Promise<ScenarioExecution>;
}

export interface ScenarioExecution {
  peer: PeerConnectResult;
  notes: string[];
}

export interface ScenarioResult {
  id: string;
  title: string;
  experiment: "B" | "C" | "E2E";
  description: string;
  expected: Outcome;
  observed: Outcome;
  passed: boolean;
  startedAt: string;
  durationMs: number;
  detail: {
    connected: boolean;
    handshakeMs: number | null;
    protocol: string | null;
    cipher: string | null;
    offeredGroups: string[];
    selectedGroup: string | null;
    clientHelloBytes: number | null;
    serverKeyShareBytes: number | null;
    httpStatus: number | null;
    peerSawDecision: string | null;
    transactionId: string | null;
    error: string | null;
  };
  notes: string[];
}

const whoami = { method: "GET", path: "/sidecar/whoami" } as const;

/** Reads the outcome from what the PEER can see: the sidecar's answer or a failed handshake. */
export function classifyOutcome(peer: PeerConnectResult): Outcome {
  if (!peer.connected) return "handshake-failed";
  const status = peer.response?.status;
  const body = peer.response?.json as { decision?: string; metadata?: { context?: { tls?: { decision?: string } } }; error?: { code?: string } } | undefined;
  // whoami answers with the decision directly; a created payment carries it in the verified context
  // the core stored with the transaction.
  const decision = status === 200 ? body?.decision : status === 201 ? body?.metadata?.context?.tls?.decision : undefined;
  if (decision === "allowed-hybrid" || decision === "allowed-fallback") return decision;
  if (status === 403 && body?.error?.code === "POLICY_VIOLATION") return "rejected-violation";
  if (status === 403 && body?.error?.code === "PEER_NOT_AUTHORIZED") return "rejected-unknown-peer";
  return "unexpected";
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: "hybrid-peer-hybrid-required",
    title: "Hybrid-capable peer, hybrid required",
    experiment: "B",
    description: "A registered peer whose policy requires hybrid key agreement connects offering X25519MLKEM768 and X25519.",
    expected: "allowed-hybrid",
    run: async (ctx) => ({
      peer: await connectAsPeer({ host: ctx.host, port: ctx.port, caPem: ctx.caPem, groups: HYBRID_CAPABLE_GROUPS, identity: ctx.identities.hybridBank, request: whoami }),
      notes: [],
    }),
  },
  {
    id: "classical-peer-fallback-allowed",
    title: "Classical-only peer, fallback allowed",
    experiment: "B",
    description: "A registered legacy peer that can only do X25519 connects. Its policy permits classical fallback, so the connection is accepted and labelled as fallback (no post-quantum key-establishment protection).",
    expected: "allowed-fallback",
    alsoAcceptable: ["handshake-failed"],
    run: async (ctx) => ({
      peer: await connectAsPeer({ host: ctx.host, port: ctx.port, caPem: ctx.caPem, groups: CLASSICAL_ONLY_GROUPS, identity: ctx.identities.legacyPsp, request: whoami }),
      notes: ["Under the hybrid-only TLS profile this handshake is refused outright, which is also correct."],
    }),
  },
  {
    id: "classical-peer-fallback-forbidden",
    title: "Classical-only peer, hybrid required",
    experiment: "B",
    description: "A registered peer whose policy requires hybrid is forced onto X25519. The connection is rejected as a policy violation.",
    expected: "rejected-violation",
    alsoAcceptable: ["handshake-failed"],
    run: async (ctx) => ({
      peer: await connectAsPeer({ host: ctx.host, port: ctx.port, caPem: ctx.caPem, groups: CLASSICAL_ONLY_GROUPS, identity: ctx.identities.strictBank, request: whoami }),
      notes: ["Under the hybrid-only TLS profile the handshake itself is refused, before identity is known."],
    }),
  },
  {
    id: "unregistered-peer",
    title: "Valid certificate, unregistered peer",
    experiment: "B",
    description: "A certificate issued by the trusted peer CA whose fingerprint is not in the registry. Unknown peers are denied by default.",
    expected: "rejected-unknown-peer",
    run: async (ctx) => ({
      peer: await connectAsPeer({ host: ctx.host, port: ctx.port, caPem: ctx.caPem, groups: HYBRID_CAPABLE_GROUPS, identity: ctx.identities.unregistered, request: whoami }),
      notes: [],
    }),
  },
  {
    id: "untrusted-certificate",
    title: "Self-signed certificate",
    experiment: "B",
    description: "A client certificate that does not chain to the trusted peer CA.",
    expected: "rejected-unknown-peer",
    run: async (ctx) => ({
      peer: await connectAsPeer({ host: ctx.host, port: ctx.port, caPem: ctx.caPem, groups: HYBRID_CAPABLE_GROUPS, identity: ctx.identities.rogue, request: whoami }),
      notes: [],
    }),
  },
  {
    id: "no-client-certificate",
    title: "No client certificate",
    experiment: "B",
    description: "A TLS client that presents no certificate at all. Network address is never treated as identity.",
    expected: "rejected-unknown-peer",
    run: async (ctx) => ({
      peer: await connectAsPeer({ host: ctx.host, port: ctx.port, caPem: ctx.caPem, groups: HYBRID_CAPABLE_GROUPS, request: whoami }),
      notes: [],
    }),
  },
  {
    id: "clienthello-downgrade-tamper",
    title: "Controlled ClientHello modification",
    experiment: "C",
    description:
      "An on-path proxy strips X25519MLKEM768 from a hybrid peer's ClientHello. The modified ClientHello no longer matches the transcript the peer hashes into Finished, so the handshake fails instead of silently completing on X25519.",
    expected: "handshake-failed",
    run: async (ctx) => {
      const proxy = await startTamperProxy({ targetHost: ctx.host, targetPort: ctx.port, removeGroup: GROUP_X25519_MLKEM768 });
      try {
        const peer = await connectAsPeer({ host: "127.0.0.1", port: proxy.port, caPem: ctx.caPem, groups: HYBRID_CAPABLE_GROUPS, identity: ctx.identities.hybridBank, request: whoami });
        return {
          peer,
          notes: [
            `Rewrote ${proxy.tampered} ClientHello.`,
            "The sidecar only ever saw the modified ClientHello (classical groups only); it cannot tell from the message alone that a hybrid group was removed. What protected the connection is TLS transcript authentication, not the policy detector.",
            "Because the handshake fails before the client authenticates, the sidecar records a failed handshake without peer identity.",
          ],
        };
      } finally {
        await proxy.close();
      }
    },
  },
  {
    id: "partner-payment-hybrid",
    title: "Payment from a hybrid peer, end to end",
    experiment: "E2E",
    description: "A hybrid-capable peer pays a real customer account through the sidecar and core. The ledger transaction records that the payment arrived over X25519MLKEM768.",
    requires: ["toAccountId"],
    expected: "allowed-hybrid",
    run: async (ctx) => {
      const params = requireParams(ctx, ["toAccountId"]);
      return { peer: await connectAsPeer({ host: ctx.host, port: ctx.port, caPem: ctx.caPem, groups: HYBRID_CAPABLE_GROUPS, identity: ctx.identities.hybridBank, request: paymentRequest(params) }), notes: [] };
    },
  },
  {
    id: "partner-payment-classical-fallback",
    title: "Payment from a classical-only peer (explicit fallback)",
    experiment: "E2E",
    description: "A legacy peer limited to X25519 pays a real customer account. Its policy permits fallback, so the payment is accepted and the ledger transaction records that it arrived over a CLASSICAL key exchange.",
    requires: ["toAccountId"],
    expected: "allowed-fallback",
    alsoAcceptable: ["handshake-failed"],
    run: async (ctx) => {
      const params = requireParams(ctx, ["toAccountId"]);
      return {
        peer: await connectAsPeer({ host: ctx.host, port: ctx.port, caPem: ctx.caPem, groups: CLASSICAL_ONLY_GROUPS, identity: ctx.identities.legacyPsp, request: paymentRequest(params) }),
        notes: ["Under the hybrid-only TLS profile this handshake is refused outright, which is also correct."],
      };
    },
  },
];

function paymentRequest(params: ScenarioParams) {
  return {
    method: "POST",
    path: "/partner/v1/payments",
    headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
    body: JSON.stringify({
      toAccountId: params.toAccountId,
      amountMinorUnits: params.amountMinorUnits ?? "10000",
      currency: "BDT",
      reference: params.reference ?? "Simulated partner payment",
    }),
  };
}

function requireParams(ctx: ScenarioContext, keys: (keyof ScenarioParams)[]): ScenarioParams {
  const params = ctx.params ?? {};
  for (const k of keys) if (!params[k]) throw new ScenarioInputError(`${k} is required for this scenario`);
  return params;
}

export function findScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export async function runScenario(def: ScenarioDefinition, ctx: ScenarioContext): Promise<ScenarioResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const { peer, notes } = await def.run(ctx);
  const observed = classifyOutcome(peer);
  const body = peer.response?.json as { decision?: string } | undefined;
  const clientHello = peer.observation.clientHello;
  const serverHello = peer.observation.serverHello;
  return {
    id: def.id,
    title: def.title,
    experiment: def.experiment,
    description: def.description,
    expected: def.expected,
    observed,
    passed: observed === def.expected || (def.alsoAcceptable ?? []).includes(observed),
    startedAt,
    durationMs: Date.now() - started,
    detail: {
      connected: peer.connected,
      handshakeMs: peer.handshakeMs === null ? null : Math.round(peer.handshakeMs * 1000) / 1000,
      protocol: peer.protocol ?? null,
      cipher: peer.cipher ?? null,
      offeredGroups: (clientHello?.offeredGroups ?? []).map((g) => groupName(g) ?? `0x${g.toString(16)}`),
      selectedGroup: serverHello?.selectedGroup === undefined ? null : (groupName(serverHello.selectedGroup) ?? `0x${serverHello.selectedGroup.toString(16)}`),
      clientHelloBytes: clientHello?.recordBytes ?? null,
      serverKeyShareBytes: serverHello?.keyShareBytes ?? null,
      httpStatus: peer.response?.status ?? null,
      peerSawDecision: body?.decision ?? (peer.response?.json as { metadata?: { context?: { tls?: { decision?: string } } } } | undefined)?.metadata?.context?.tls?.decision ?? null,
      transactionId: (peer.response?.json as { id?: string } | undefined)?.id ?? null,
      error: peer.error ?? null,
    },
    notes,
  };
}
