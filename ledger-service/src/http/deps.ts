import type { AppConfig } from "../config.js";
import type { AuditService } from "../app/audit-service.js";
import type { IdentityService } from "../app/identity-service.js";
import type { LedgerService } from "../app/ledger-service.js";
import type { TokenService } from "../identity/tokens.js";
import type { Guards } from "./guards.js";

/** Everything the HTTP layer needs, assembled once by the composition root. */
export interface ServerDeps {
  ledger: LedgerService;
  identity: IdentityService;
  audit: AuditService;
  tokens: TokenService;
  config: AppConfig;
  /** Readiness probe: resolves when the backing store is reachable, rejects otherwise. Optional
   *  (undefined is treated as ready, e.g. the in-memory store). The composition root supplies it. */
  ping?: () => Promise<void>;
}

export interface RouteDeps extends ServerDeps {
  guards: Guards;
}
