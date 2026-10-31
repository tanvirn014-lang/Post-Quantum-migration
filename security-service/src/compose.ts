import { JwksTokenVerifier } from "./auth/verifier.js";
import type { AppConfig } from "./config.js";
import { prepareDatabase } from "./db/migrate.js";
import type { ServerDeps } from "./http/deps.js";
import { AuditLog } from "./repos/audit.js";
import { ConfigRepository } from "./repos/config.js";
import { PeerRepository } from "./repos/peers.js";
import { SidecarRepository } from "./repos/sidecars.js";
import { TelemetryRepository } from "./repos/telemetry.js";
import { CbomService, DEFAULT_GROUND_TRUTH_FILE } from "./services/cbom-service.js";
import { ConfigService } from "./services/config-service.js";
import { CbomRepository } from "./repos/cbom.js";
import { defaultSourceOptions, type CbomSourceOptions } from "./cbom/sources.js";
import type { TokenVerifier } from "./auth/verifier.js";
import type pg from "pg";

export interface CbomOverrides extends Partial<CbomSourceOptions> {
  groundTruthFile?: string;
}

/** Wires repositories and services around a migrated pool. Shared by the server and by tests. */
export function composeDeps(pool: pg.Pool, config: AppConfig, verifier: TokenVerifier, clock?: () => Date, cbom: CbomOverrides = {}): ServerDeps {
  const audit = new AuditLog(pool, clock);
  const configRepo = new ConfigRepository(pool);
  const peersRepo = new PeerRepository(pool);
  return {
    pool,
    config,
    verifier,
    audit,
    configRepo,
    peersRepo,
    telemetryRepo: new TelemetryRepository(pool),
    sidecarsRepo: new SidecarRepository(pool),
    configService: new ConfigService(pool, configRepo, peersRepo, audit),
    cbomService: new CbomService(pool, new CbomRepository(pool), audit, configRepo, { ...defaultSourceOptions(), ...cbom }, cbom.groundTruthFile ?? DEFAULT_GROUND_TRUTH_FILE),
  };
}

export async function composeApplication(config: AppConfig): Promise<{ deps: ServerDeps; close(): Promise<void> }> {
  const pool = await prepareDatabase(config.databaseUrl);
  const verifier = JwksTokenVerifier.remote(config.jwksUrl, config.jwtIssuer, config.jwtAudience);
  return { deps: composeDeps(pool, config, verifier), close: () => pool.end() };
}
