import { session } from "../../lib/api/clients.js";
import type { Role } from "../../lib/auth/session.js";
import { installFetch, json, noContent } from "./fetch-mock.js";

const LEDGER_PERMISSIONS: Record<Role, string[]> = {
  customer: ["account:read:own", "transfer:create:own"],
  operator: ["account:read:any", "account:create", "transaction:post:journal", "customer:create", "user:read"],
  security_admin: ["user:read", "user:create:staff", "user:disable", "audit:read", "audit:verify"],
  auditor: ["account:read:any", "user:read", "audit:read", "audit:verify"],
};

/**
 * Puts the shared browser session singleton into an authenticated state by running the real
 * login flow against a stubbed ledger-service, then restores fetch so the test can install its own.
 */
export async function signInAs(role: Role, overrides: { customerId?: string | null; mustChangePassword?: boolean } = {}): Promise<void> {
  const user = {
    id: `user-${role}`,
    email: `${role}@bank.test`,
    role,
    customerId: overrides.customerId !== undefined ? overrides.customerId : role === "customer" ? "cust-1" : null,
    mustChangePassword: overrides.mustChangePassword ?? false,
  };
  const stub = installFetch({
    "POST /auth/login": () => json({ accessToken: "token-1", tokenType: "Bearer", expiresIn: 600, user }),
    "GET /auth/me": () => json({ user, permissions: LEDGER_PERMISSIONS[role] }),
  });
  try {
    await session.login(user.email, "irrelevant-test-password");
  } finally {
    stub.uninstall();
  }
}

export async function signOut(): Promise<void> {
  const stub = installFetch({ "POST /auth/logout": () => noContent() });
  try {
    await session.logout();
  } finally {
    stub.uninstall();
  }
}
