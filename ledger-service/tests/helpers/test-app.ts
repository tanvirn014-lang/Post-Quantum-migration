import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { MemoryAuditStore } from "../../src/adapters/memory/audit-store.js";
import { MemoryIdentityStore } from "../../src/adapters/memory/identity-store.js";
import { MemoryLedgerStore } from "../../src/adapters/memory/ledger-store.js";
import { AuditService } from "../../src/app/audit-service.js";
import { IdentityService } from "../../src/app/identity-service.js";
import { LedgerService } from "../../src/app/ledger-service.js";
import { testConfig, type AppConfig } from "../../src/config.js";
import type { ServerDeps } from "../../src/http/deps.js";
import { buildServer } from "../../src/http/server.js";
import { PasswordHasher } from "../../src/identity/password.js";
import type { Role } from "../../src/identity/roles.js";
import { TokenService } from "../../src/identity/tokens.js";
import type { Customer, User } from "../../src/identity/types.js";

export const TEST_PASSWORD = "correct-horse-battery-staple";

export interface TestApp {
  app: FastifyInstance;
  deps: ServerDeps;
  stores: { ledger: MemoryLedgerStore; identity: MemoryIdentityStore; audit: MemoryAuditStore };
  hasher: PasswordHasher;
  /** Mutable clock shared with the identity service. */
  clock: { now: Date };
  staff(role: Exclude<Role, "customer">): Promise<{ user: User; token: string }>;
  customer(label?: string): Promise<{ user: User; customer: Customer; token: string }>;
  login(email: string, password?: string): Promise<{ statusCode: number; body: any; cookies: { name: string; value: string }[] }>;
  bearer(token: string): { authorization: string };
}

/**
 * Builds the full application on in-memory adapters with a cheap password-hash cost, plus
 * helpers to mint users of each role and obtain real tokens through the real login flow.
 */
export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const config = testConfig({ rateLimitMax: 100_000, loginRateLimitMax: 100_000, ...overrides });
  const stores = { ledger: new MemoryLedgerStore(), identity: new MemoryIdentityStore(), audit: new MemoryAuditStore() };
  const clock = { now: new Date("2026-11-01T10:00:00Z") };
  const hasher = new PasswordHasher({ logN: 10 });
  const tokens = await TokenService.create({
    privateKeyPem: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    accessTtlSeconds: config.accessTokenTtlSeconds,
  });
  const audit = new AuditService(stores.audit, () => new Date(clock.now));
  const identity = new IdentityService({
    store: stores.identity,
    tokens,
    hasher,
    audit,
    limits: { maxFailedAttempts: config.loginMaxFailedAttempts, lockMinutes: config.loginLockMinutes, refreshTtlDays: config.refreshTokenTtlDays },
    clock: () => new Date(clock.now),
  });
  const deps: ServerDeps = { ledger: new LedgerService(stores.ledger), identity, audit, tokens, config };
  const app = buildServer(deps, { logger: false });

  async function login(email: string, password = TEST_PASSWORD) {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
    return {
      statusCode: res.statusCode,
      body: res.json(),
      cookies: res.cookies.map((c) => ({ name: c.name, value: c.value })),
    };
  }

  return {
    app,
    deps,
    stores,
    hasher,
    clock,
    async staff(role) {
      const user = await stores.identity.createStaffUser({
        email: `${role}-${randomUUID().slice(0, 8)}@bank.test`,
        passwordHash: await hasher.hash(TEST_PASSWORD),
        role,
        customerId: null,
        mustChangePassword: false,
      });
      const result = await login(user.email);
      return { user, token: result.body.accessToken as string };
    },
    async customer(label = "Customer") {
      const email = `customer-${randomUUID().slice(0, 8)}@bank.test`;
      const { customer, user } = await stores.identity.createCustomerWithUser(
        { fullName: label, email },
        { email, passwordHash: await hasher.hash(TEST_PASSWORD), mustChangePassword: false },
      );
      const result = await login(email);
      return { user, customer, token: result.body.accessToken as string };
    },
    login,
    bearer: (token) => ({ authorization: `Bearer ${token}` }),
  };
}
