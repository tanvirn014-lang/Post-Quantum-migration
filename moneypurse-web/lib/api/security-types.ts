// Mirrors security-service's response shapes (security-service/src/http/routes/*).

export type PeerProfile = "hybrid-required" | "classical-allowed";
export type KeyExchange = "hybrid" | "classical" | "unknown";
export type Decision = "allowed-hybrid" | "allowed-fallback" | "rejected-violation" | "rejected-unknown-peer" | "handshake-failed";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type ImplementationStatus = "LIVE" | "SIM" | "PLANNED";

export interface Peer {
  id: string;
  name: string;
  description: string;
  certSha256: string;
  profile: PeerProfile;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TlsProfile {
  name: string;
  description: string;
  groups: string[];
  builtin: boolean;
  createdAt: string;
  offersHybrid: boolean;
  allowsClassical: boolean;
  summary: string;
}

export interface TlsGroup {
  name: string;
  code: number;
  kind: "hybrid" | "classical";
  description: string;
}

export interface CryptoProvider {
  id: string;
  name: string;
  library: string;
  status: "LIVE" | "PLANNED";
  selectable: boolean;
  supportedGroups: string[];
  notes: string;
  observed: Record<string, unknown> | null;
}

export interface ConfigHistoryEntry {
  version: number;
  kind: string;
  summary: string;
  activeProfile: string;
  actorUserId: string | null;
  actorRole: string | null;
  changedAt: string;
  firstAppliedAt: string | null;
  timeToApplyMs: number | null;
}

export interface CryptoConfig {
  version: number;
  activeProfile: TlsProfile;
  changedAt: string;
  summary: { offersHybrid: boolean; allowsClassical: boolean; summary: string };
  history: ConfigHistoryEntry[];
}

export interface LatencyStats {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface TelemetrySummary {
  sinceHours: number;
  total: number;
  byDecision: Record<string, number>;
  byKeyExchange: Record<string, number>;
  openAlerts: number;
  handshakeMs: Record<string, LatencyStats>;
}

export interface SidecarStatus {
  instanceId: string;
  startedAt: string;
  lastSeenAt: string;
  ageSeconds: number;
  stale: boolean;
  appliedConfigVersion: number;
  inSync: boolean;
  activeProfile: string;
  runtime: Record<string, unknown>;
  listener: Record<string, unknown>;
  counters: Record<string, unknown>;
}

export interface Overview {
  config: { version: number; profile: string; groups: string[]; summary: string; changedAt: string };
  sidecars: SidecarStatus[];
  peers: { total: number; enabled: number; hybridRequired: number };
  telemetry: TelemetrySummary;
}

export interface ConnectionEvent {
  id: string;
  correlationId: string;
  occurredAt: string;
  remoteAddr: string | null;
  peerId: string | null;
  peerName: string | null;
  certSha256: string | null;
  expectedProfile: PeerProfile | null;
  tlsVersion: string | null;
  cipher: string | null;
  offeredGroups: { code: number; name?: string }[];
  negotiatedGroup: string | null;
  negotiatedGroupCode: number | null;
  keyExchange: KeyExchange;
  clientKeyShareBytes: number | null;
  serverKeyShareBytes: number | null;
  decision: Decision;
  severity: Severity;
  reason: string;
  handshakeMs: number | null;
  configVersion: number;
  requestsForwarded: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  ackNote: string | null;
}

export interface ConnectionPage {
  events: ConnectionEvent[];
  nextBefore: string | null;
}

export interface ComponentStatus {
  id: string;
  name: string;
  status: ImplementationStatus;
  summary: string;
  evidence: string[];
  limitations: string[];
  outOfScope?: boolean;
}
