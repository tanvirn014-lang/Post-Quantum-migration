import type pg from "pg";
import type { TokenVerifier } from "../auth/verifier.js";
import type { AppConfig } from "../config.js";
import type { AuditLog } from "../repos/audit.js";
import type { ConfigRepository } from "../repos/config.js";
import type { PeerRepository } from "../repos/peers.js";
import type { SidecarRepository } from "../repos/sidecars.js";
import type { TelemetryRepository } from "../repos/telemetry.js";
import type { CbomService } from "../services/cbom-service.js";
import type { ResearchService } from "../services/research-service.js";
import type { ConfigService } from "../services/config-service.js";
import type { Guards } from "./guards.js";

export interface ServerDeps {
  pool: pg.Pool;
  config: AppConfig;
  verifier: TokenVerifier;
  audit: AuditLog;
  configRepo: ConfigRepository;
  peersRepo: PeerRepository;
  telemetryRepo: TelemetryRepository;
  sidecarsRepo: SidecarRepository;
  configService: ConfigService;
  cbomService: CbomService;
  researchService: ResearchService;
}

export interface RouteDeps extends ServerDeps {
  guards: Guards;
}
