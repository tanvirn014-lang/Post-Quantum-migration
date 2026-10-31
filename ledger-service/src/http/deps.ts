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
}

export interface RouteDeps extends ServerDeps {
  guards: Guards;
}
