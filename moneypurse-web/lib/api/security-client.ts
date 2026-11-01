import type { ApiClient } from "./api-client";
import { securityApi } from "./clients";
import type { AuditPage, ChainVerification } from "./types";
import type {
  BenchmarkDetail,
  BenchmarkIndexEntry,
  CbomComparison,
  CbomMeta,
  ComponentStatus,
  ConnectionEvent,
  ConnectionPage,
  CryptoConfig,
  CryptoProvider,
  Decision,
  GroundTruth,
  HndlRun,
  KeyExchange,
  MoscaInput,
  MoscaResult,
  Overview,
  Peer,
  PeerProfile,
  QuantumAssumption,
  Scenario,
  ScenarioParams,
  ScenarioResult,
  TlsGroup,
  TlsProfile,
} from "./security-types";

export interface ConnectionFilter {
  limit?: number;
  before?: string;
  decision?: Decision;
  keyExchange?: KeyExchange;
  alertsOnly?: boolean;
}

export interface CreatePeerInput {
  name: string;
  description: string;
  certSha256: string;
  profile: PeerProfile;
  enabled: boolean;
}

export interface UpdatePeerInput {
  description?: string;
  profile?: PeerProfile;
  enabled?: boolean;
}

export interface CreateProfileInput {
  name: string;
  description: string;
  groups: string[];
}

export function createSecurityClient(api: ApiClient) {
  return {
    getOverview: () => api.get<Overview>("/v1/overview"),
    getComponents: () => api.get<ComponentStatus[]>("/v1/status/components"),

    listPeers: () => api.get<Peer[]>("/v1/peers"),
    createPeer: (input: CreatePeerInput) => api.post<Peer>("/v1/peers", input),
    updatePeer: (id: string, patch: UpdatePeerInput) => api.patch<Peer>(`/v1/peers/${id}`, patch),
    deletePeer: (id: string) => api.delete<void>(`/v1/peers/${id}`),

    getCryptoConfig: () => api.get<CryptoConfig>("/v1/crypto/config"),
    listProfiles: () => api.get<TlsProfile[]>("/v1/crypto/profiles"),
    listGroups: () => api.get<TlsGroup[]>("/v1/crypto/groups"),
    listProviders: () => api.get<CryptoProvider[]>("/v1/crypto/providers"),
    setActiveProfile: (profile: string, note?: string) =>
      api.post<{ version: number; activeProfile: TlsProfile; changedAt: string }>("/v1/crypto/config/active", { profile, ...(note ? { note } : {}) }),
    createProfile: (input: CreateProfileInput) => api.post<TlsProfile>("/v1/crypto/profiles", input),

    listConnections: (f: ConnectionFilter = {}) =>
      api.get<ConnectionPage>("/v1/telemetry/connections", {
        query: { limit: f.limit, before: f.before, decision: f.decision, keyExchange: f.keyExchange, alertsOnly: f.alertsOnly ? true : undefined },
      }),
    listAlerts: (includeAcknowledged: boolean) =>
      api.get<ConnectionEvent[]>("/v1/telemetry/alerts", { query: { includeAcknowledged: includeAcknowledged ? true : undefined } }),
    acknowledgeAlert: (id: string, note?: string) =>
      api.post<ConnectionEvent>(`/v1/telemetry/alerts/${id}/acknowledge`, note ? { note } : {}),

    listAuditEvents: (opts: { limit?: number; beforeSeq?: number } = {}) =>
      api.get<AuditPage>("/v1/audit/events", { query: { limit: opts.limit, beforeSeq: opts.beforeSeq } }),
    verifyAuditChain: () => api.get<ChainVerification>("/v1/audit/verify"),

    listCboms: (limit = 20) => api.get<CbomMeta[]>("/v1/cbom", { query: { limit } }),
    generateCbom: (lookbackHours: number) => api.post<CbomMeta>("/v1/cbom/generate", { lookbackHours }),
    getGroundTruth: () => api.get<GroundTruth>("/v1/cbom/ground-truth"),
    compareCbom: (id: string) => api.post<CbomComparison>(`/v1/cbom/${id}/compare`, {}),
    getCbomComparison: (id: string) => api.get<CbomComparison>(`/v1/cbom/${id}/comparison`),
    downloadCbomDocument: (id: string) => api.getBlob(`/v1/cbom/${id}/document`),

    runHndl: (message: string, quantumAssumption: QuantumAssumption) => api.post<HndlRun>("/v1/hndl/run", { message, quantumAssumption }),
    listHndlRuns: (limit = 10) => api.get<HndlRun[]>("/v1/hndl/runs", { query: { limit } }),
    mosca: (input: MoscaInput) => api.post<MoscaResult>("/v1/hndl/mosca", input),

    listBenchmarks: (limit = 20) => api.get<BenchmarkIndexEntry[]>("/v1/benchmarks", { query: { limit } }),
    getBenchmark: (runId: string) => api.get<BenchmarkDetail>(`/v1/benchmarks/${encodeURIComponent(runId)}`),
    downloadBenchmarkCsv: (runId: string, which: "handshakes" | "throughput") => api.getBlob(`/v1/benchmarks/${encodeURIComponent(runId)}/${which}.csv`),

    listScenarios: () => api.get<Scenario[]>("/v1/experiments/scenarios"),
    runScenario: (scenarioId: string, params?: ScenarioParams) => api.post<ScenarioResult>("/v1/experiments/run", { scenarioId, ...(params ? { params } : {}) }),
  };
}

export type SecurityClient = ReturnType<typeof createSecurityClient>;

export const security = createSecurityClient(securityApi);
