import { JwksTokenVerifier } from "./auth/verifier.js";
import type { AppConfig } from "./config.js";
import { prepareDatabase } from "./db/migrate.js";
import type { ServerDeps } from "./http/deps.js";
import { AuditLog } from "./repos/audit.js";
import { ConfigRepository } from "./repos/config.js";
import { PeerRepository } from "./repos/peers.js";
import { SidecarRepository } from "./repos/sidecars.js";
import { TelemetryRepository } from "./repos/telemetry.js";
import { ConfigService } from "./services/config-service.js";
import type { TokenVerifier } from "./auth/verifier.js";
import type pg from "pg";

/** Wires repositories and services around a migrated pool. Shared by the server and by tests. */
export function composeDeps(pool: pg.Pool, config: AppConfig, verifier: TokenVerifier, clock?: () => Date): ServerDeps {
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
  };
}

export async function composeApplication(config: AppConfig): Promise<{ deps: ServerDeps; close(): Promise<void> }> {
  const pool = await prepareDatabase(config.databaseUrl);
  const verifier = JwksTokenVerifier.remote(config.jwksUrl, config.jwtIssuer, config.jwtAudience);
  return { deps: composeDeps(pool, config, verifier), close: () => pool.end() };
}
