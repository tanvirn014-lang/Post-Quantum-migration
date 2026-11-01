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

// ---- CBOM (security-service/src/http/routes/cbom-routes.ts, src/cbom/compare.ts) ----

export interface CbomValidation {
  valid: boolean;
  schema: string;
  errors: { path: string; message: string }[];
}

export interface CbomMeta {
  id: string;
  generatedAt: string;
  generatedBy: string | null;
  specVersion: string;
  serialNumber: string;
  contentSha256: string;
  assets: { total: number; declared: number; observed: number };
  lookbackHours: number;
  validation: CbomValidation;
  /** Which sources were read and refused; shape is documented in cbom-service.ts, read defensively. */
  sourceSummary: Record<string, unknown>;
}

export interface GroundTruth {
  version: number;
  createdAt: string;
  createdBy: string | null;
  scope: string;
  preparedBy: string;
  itemCount: number;
  contentSha256: string;
}

export type DiscrepancyType = "missing" | "unexpected" | "provenance-mismatch" | "attribute-mismatch" | "location-gap";

export interface Discrepancy {
  type: DiscrepancyType;
  kind: string;
  name: string;
  detail: string;
}

export interface KindCounts {
  groundTruth: number;
  generated: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface ComparisonMetrics {
  groundTruthItems: number;
  generatedAssets: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  completeness: number;
  precision: number | null;
  denominators: { completeness: string; precision: string };
  provenanceAgreement: { matched: number; agreeing: number; ratio: number | null };
  locationRecall: { groundTruthLocations: number; found: number; ratio: number | null };
  byKind: Record<string, KindCounts>;
}

export interface CbomComparison {
  id: string;
  cbomId: string;
  groundTruthVersion: number;
  createdAt: string;
  createdBy: string | null;
  metrics: ComparisonMetrics;
  discrepancies: Discrepancy[];
}

// ---- HNDL educational simulator (src/hndl/simulator.ts) ----

export type QuantumAssumption = "none" | "x25519-broken" | "both-broken";

export interface CapturedSession {
  capture: { clientKeyShareBytes: number; serverKeyShareBytes: number; ciphertextHex: string; ciphertextBytes: number };
  recovered: boolean;
  recoveredPlaintext: string | null;
  reason: string;
}

export interface HndlRun {
  id: string;
  createdAt: string;
  label: "SIMULATION";
  disclaimer: string;
  assumption: QuantumAssumption;
  assumptionExplained: string;
  sessions: { classical: CapturedSession; hybrid: CapturedSession };
  takeaways: string[];
  primitives: string[];
}

export interface MoscaInput {
  shelfLifeYears: number;
  migrationYears: number;
  yearsToQuantum: number;
}

export interface MoscaResult extends MoscaInput {
  atRisk: boolean;
  exposureYears: number;
  note: string;
}

// ---- Benchmarks (src/http/routes/research-routes.ts, pqc-sidecar/src/bench/harness.ts) ----

export type IntegrityStatus = "valid" | "invalid" | "unverifiable";

export interface BenchmarkIntegrity {
  status: IntegrityStatus;
  problems: string[];
}

export interface BenchmarkIndexEntry {
  runId: string;
  receivedAt: string;
  label: string;
  commit: string | null;
  workingTreeDirty: boolean | null;
  csv: { handshakes: { bytes: number; sha256: string }; throughput: { bytes: number; sha256: string } };
  integrity: BenchmarkIntegrity;
}

/** JSON turns NaN into null, so any statistic can be null (e.g. a CI over zero runs). */
export interface Distribution {
  n: number;
  mean: number | null;
  stddev: number | null;
  min: number | null;
  median: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

export interface BenchConditionSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  configurationMismatches: number;
  latencyMs: Distribution;
  clientHelloRecordBytes: number | null;
  serverHelloRecordBytes: number | null;
  bytesSentPerHandshake: number | null;
  bytesReceivedPerHandshake: number | null;
}

export interface ConfidenceInterval {
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  level: number;
  resamples: number;
  seed: number;
}

export type BenchVerdict = "hybrid-slower" | "hybrid-faster" | "not-distinguishable";

export interface BenchLatencySummary {
  classical: BenchConditionSummary;
  hybrid: BenchConditionSummary;
  hybridMinusClassicalMedianMs: ConfidenceInterval;
  h2Verdict: BenchVerdict;
  h1: { extraClientHelloBytes: number | null; extraServerHelloBytes: number | null; extraBytesSent: number | null; extraBytesReceived: number | null };
}

export interface BenchThroughputRow {
  concurrency: number;
  condition: "classical" | "hybrid";
  runs: number;
  handshakesPerSecondMedian: number | null;
  clientCpuMsPerHandshakeMedian: number | null;
  serverCpuMsPerHandshakeMedian: number | null;
  serverRssMiBMedian: number | null;
  failures: number;
}

/** The environment record the harness writes; only the fields the console shows are typed. */
export interface BenchManifest {
  runId?: string;
  startedAt?: string;
  host?: { os?: string; release?: string; arch?: string; cpuModel?: string; logicalCores?: number; totalMemoryMiB?: number };
  runtime?: { node?: string; openssl?: string };
  sourceRevision?: { commit?: string | null; workingTreeDirty?: boolean | null };
  topology?: { networkMode?: string };
  workload?: { preset?: string; runs?: number; handshakesPerRunPerCondition?: number; warmupHandshakesPerCondition?: number };
  caveats?: string[];
}

export interface BenchmarkDetail extends BenchmarkIndexEntry {
  manifest: BenchManifest;
  summary: { latency?: BenchLatencySummary; throughput?: BenchThroughputRow[] };
}

// ---- Experiments (security-service/src/http/routes/experiment-routes.ts -> peer simulator) ----

export type ScenarioOutcome = Decision | "unexpected";

export interface Scenario {
  id: string;
  title: string;
  experiment: "B" | "C" | "E2E";
  description: string;
  expected: ScenarioOutcome;
  requires: string[];
}

export interface ScenarioParams {
  toAccountId?: string;
  amountMinorUnits?: string;
  reference?: string;
}

export interface ScenarioResult {
  id: string;
  title: string;
  experiment: "B" | "C" | "E2E";
  description: string;
  expected: ScenarioOutcome;
  observed: ScenarioOutcome;
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
