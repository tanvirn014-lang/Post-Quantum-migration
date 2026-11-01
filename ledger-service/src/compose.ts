import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MemoryAuditStore } from "./adapters/memory/audit-store.js";
import { MemoryIdentityStore } from "./adapters/memory/identity-store.js";
import { MemoryLedgerStore } from "./adapters/memory/ledger-store.js";
import { PostgresAuditStore } from "./adapters/postgres/audit-store.js";
import { createPool } from "./adapters/postgres/db.js";
import { PostgresIdentityStore } from "./adapters/postgres/identity-store.js";
import { PostgresLedgerStore } from "./adapters/postgres/ledger-store.js";
import { JoseSupabaseVerifier } from "./adapters/supabase/verifier.js";
import { AuditService } from "./app/audit-service.js";
import { IdentityService } from "./app/identity-service.js";
import { LedgerService } from "./app/ledger-service.js";
import type { AppConfig } from "./config.js";
import type { ServerDeps } from "./http/deps.js";
import { PasswordHasher } from "./identity/password.js";
import { TokenService } from "./identity/tokens.js";
import type { AuditStore } from "./ports/audit-store.js";
import type { IdentityStore } from "./ports/identity-store.js";
import type { LedgerStore } from "./ports/ledger-store.js";

export interface Application {
  deps: ServerDeps;
  stores: { ledger: LedgerStore; identity: IdentityStore; audit: AuditStore };
  close(): Promise<void>;
}

async function loadSigningKeyPem(config: AppConfig): Promise<string> {
  if (config.jwtPrivateKey) return config.jwtPrivateKey.replace(/\\n/g, "\n");
  if (config.jwtPrivateKeyFile) return readFile(config.jwtPrivateKeyFile, "utf8");
  // Config validation already rejects this in production.
  console.warn(
    "No JWT signing key configured (JWT_PRIVATE_KEY_FILE). Generated an EPHEMERAL key: tokens stop " +
      "verifying after a restart and other services' cached JWKS will go stale. Run `npm run setup` at the repo root.",
  );
  return generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

/** The composition root: the only place concrete adapters are chosen and wired together. */
export async function composeApplication(config: AppConfig): Promise<Application> {
  let stores: Application["stores"];
  let closePool: () => Promise<void> = async () => {};

  if (config.ledgerStore === "postgres") {
    const pool = createPool(config.databaseUrl, config.pgPoolMax);
    stores = {
      ledger: new PostgresLedgerStore(pool),
      identity: new PostgresIdentityStore(pool),
      audit: new PostgresAuditStore(pool),
    };
    closePool = () => pool.end();
  } else {
    console.warn(
      "LEDGER_STORE=memory - using in-process stores. Nothing persists across restarts and this is " +
        "not for production use. Set LEDGER_STORE=postgres + DATABASE_URL for a real deployment.",
    );
    stores = { ledger: new MemoryLedgerStore(), identity: new MemoryIdentityStore(), audit: new MemoryAuditStore() };
  }

  const tokens = await TokenService.create({
    privateKeyPem: await loadSigningKeyPem(config),
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    accessTtlSeconds: config.accessTokenTtlSeconds,
  });
  const audit = new AuditService(stores.audit);
  const supabase = config.supabaseUrl
    ? new JoseSupabaseVerifier({
        issuer: `${config.supabaseUrl}/auth/v1`,
        jwksUrl: `${config.supabaseUrl}/auth/v1/.well-known/jwks.json`,
        audience: config.supabaseAudience,
      })
    : undefined;
  if (supabase) console.info(`Supabase add-on identity layer enabled (issuer ${config.supabaseUrl}/auth/v1).`);
  const identity = new IdentityService({
    store: stores.identity,
    tokens,
    hasher: new PasswordHasher(),
    audit,
    limits: {
      maxFailedAttempts: config.loginMaxFailedAttempts,
      lockMinutes: config.loginLockMinutes,
      refreshTtlDays: config.refreshTokenTtlDays,
    },
    supabase,
    supabaseAutoProvision: config.supabaseAutoProvision,
  });

  return {
    deps: { ledger: new LedgerService(stores.ledger), identity, audit, tokens, config },
    stores,
    close: closePool,
  };
}
