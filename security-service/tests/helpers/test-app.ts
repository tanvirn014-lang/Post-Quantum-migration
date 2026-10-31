import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SignJWT, importPKCS8, type JWK } from "jose";
import type pg from "pg";
import type { Role } from "../../src/auth/permissions.js";
import { JwksTokenVerifier } from "../../src/auth/verifier.js";
import { composeDeps } from "../../src/compose.js";
import type { AppConfig } from "../../src/config.js";
import { createPool, ensureDatabase, withDatabase } from "../../src/db/pool.js";
import { applyMigrations } from "../../src/db/migrate.js";
import type { ServerDeps } from "../../src/http/deps.js";
import { buildServer } from "../../src/http/server.js";

const BASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? "postgres://ledger:ledger@localhost:5432/ledger";
// Override with TEST_DATABASE_NAME so concurrent checkouts/worktrees never share (and wipe) one database.
const TEST_DB = process.env["TEST_DATABASE_NAME"] ?? "security_test";

export const SIDECAR_TOKEN = "test-sidecar-token-0123456789abcdef0123456789";
export const BENCH_TOKEN = "test-bench-token-0123456789abcdef012345678901";

export const ISSUER = "pq-bank-ledger-service";
export const AUDIENCE = "pq-bank-platform";

/** Creates the isolated test database on first use, migrates it and returns a pool. */
export async function setupPool(): Promise<pg.Pool> {
  await ensureDatabase(withDatabase(BASE_URL, "postgres"), TEST_DB);
  const pool = createPool(withDatabase(BASE_URL, TEST_DB));
  await applyMigrations(pool, () => {});
  return pool;
}

export async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("ALTER TABLE audit_events DISABLE TRIGGER USER");
  try {
    await pool.query("TRUNCATE peers, connection_events, sidecar_instances, config_applications, audit_events, config_changes RESTART IDENTITY");
  } finally {
    await pool.query("ALTER TABLE audit_events ENABLE TRIGGER USER");
  }
  await pool.query("DELETE FROM tls_profiles WHERE NOT builtin");
  await pool.query("INSERT INTO config_changes (kind, summary, active_profile) VALUES ('initial', 'Initial configuration', 'hybrid-preferred')");
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 0,
    databaseUrl: withDatabase(BASE_URL, TEST_DB),
    pgPoolMax: 5,
    corsOrigins: ["http://localhost:3100"],
    jwksUrl: "http://localhost:0/unused",
    jwtIssuer: ISSUER,
    jwtAudience: AUDIENCE,
    sidecarToken: SIDECAR_TOKEN,
    benchToken: BENCH_TOKEN,
    peerSimUrl: undefined,
    peerSimToken: undefined,
    rateLimitMax: 100_000,
    sidecarStaleSeconds: 45,
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  deps: ServerDeps;
  pool: pg.Pool;
  /** Mints an access token the way ledger-service would, for a fresh user of `role`. */
  token(role: Role, opts?: { userId?: string; expiresIn?: string }): Promise<string>;
  bearer(token: string): { authorization: string };
  sidecar: { authorization: string };
}

export async function createTestApp(pool: pg.Pool, overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const pem = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const privateKey = await importPKCS8(pem, "EdDSA");
  const jwk = createPublicKey(createPrivateKey(pem)).export({ format: "jwk" }) as JWK;
  const keySet = { keys: [{ ...jwk, kid: "test-key", alg: "EdDSA", use: "sig" }] };
  const verifier = JwksTokenVerifier.local(keySet, ISSUER, AUDIENCE);

  const config = testConfig(overrides);
  const deps = composeDeps(pool, config, verifier);
  const app = buildServer(deps, { logger: false });

  return {
    app,
    deps,
    pool,
    async token(role, opts = {}) {
      return new SignJWT({ role })
        .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
        .setSubject(opts.userId ?? randomUUID())
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(opts.expiresIn ?? "10m")
        .sign(privateKey);
    },
    bearer: (token) => ({ authorization: `Bearer ${token}` }),
    sidecar: { authorization: `Bearer ${SIDECAR_TOKEN}` },
  };
}

export const FINGERPRINT_A = "a".repeat(64);
export const FINGERPRINT_B = "b".repeat(64);
