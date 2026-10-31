import type { Decision, KeyExchange, PeerProfile, PeerRecord } from "../policy/evaluate.js";

/** What security-service tells the sidecar to enforce (GET /internal/v1/sidecar-config). */
export interface SidecarConfigPayload {
  version: number;
  tlsProfile: { name: string; groups: string[]; description: string };
  peers: PeerRecord[];
  generatedAt: string;
}

/** One evaluated connection, in the shape security-service's ingestion API accepts. */
export interface ConnectionEventPayload {
  id: string;
  correlationId: string;
  occurredAt: string;
  remoteAddr?: string;
  peerId?: string;
  peerName?: string;
  certSha256?: string;
  expectedProfile?: PeerProfile;
  tlsVersion?: string;
  cipher?: string;
  offeredGroups: { code: number; name?: string }[];
  negotiatedGroup?: string;
  negotiatedGroupCode?: number;
  keyExchange: KeyExchange;
  clientKeyShareBytes?: number;
  serverKeyShareBytes?: number;
  decision: Decision;
  reason: string;
  handshakeMs?: number;
  configVersion: number;
  requestsForwarded?: number;
}

export interface EventSink {
  emit(event: ConnectionEventPayload): void;
}

export interface SidecarCounters {
  connectionsAccepted: number;
  connectionsRefusedOverLimit: number;
  handshakesCompleted: number;
  handshakesFailed: number;
  decisions: Record<string, number>;
  requestsForwarded: number;
  requestsRejected: number;
  upstreamErrors: number;
  eventsSuppressed: number;
  configsApplied: number;
  configsRejected: number;
}
