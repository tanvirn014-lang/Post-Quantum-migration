import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROLES, type Role } from "../../src/identity/roles.js";
import { createTestApp, type TestApp } from "../helpers/test-app.js";

type Method = "GET" | "POST";
interface Endpoint {
  name: string;
  method: Method;
  url: (ctx: { customerId: string; accountId: string }) => string;
  payload?: (ctx: { customerId: string; accountId: string }) => unknown;
  headers?: Record<string, string>;
  /** Roles expected to be allowed to reach the handler (anything but 401/403). */
  allowed: Role[];
}

const endpoints: Endpoint[] = [
  { name: "list customers", method: "GET", url: () => "/customers", allowed: ["operator", "auditor"] },
  {
    name: "create customer",
    method: "POST",
    url: () => "/customers",
    payload: () => ({ fullName: "X", email: `${randomUUID().slice(0, 8)}@bank.test`, password: "a-very-long-passphrase-1" }),
    allowed: ["operator"],
  },
  { name: "list users", method: "GET", url: () => "/users", allowed: ["operator", "security_admin", "auditor"] },
  {
    name: "create staff user",
    method: "POST",
    url: () => "/users",
    payload: () => ({ email: `${randomUUID().slice(0, 8)}@bank.test`, role: "auditor", password: "a-very-long-passphrase-1" }),
    allowed: ["security_admin"],
  },
  {
    name: "open account",
    method: "POST",
    url: () => "/accounts",
    payload: ({ customerId }) => ({ ownerCustomerId: customerId, currency: "BDT" }),
    allowed: ["operator"],
  },
  { name: "list accounts", method: "GET", url: () => "/accounts", allowed: ["customer", "operator", "auditor"] },
  {
    name: "post journal",
    method: "POST",
    url: () => "/transactions",
    headers: { "idempotency-key": "rbac-journal-key-1" },
    payload: ({ accountId }) => ({ description: "x", postings: [{ accountId, amountMinorUnits: "1", currency: "BDT" }] }),
    allowed: ["operator"],
  },
  {
    name: "customer transfer",
    method: "POST",
    url: () => "/transfers",
    headers: { "idempotency-key": "rbac-transfer-key-1" },
    payload: ({ accountId }) => ({ fromAccountId: accountId, toAccountId: "acc_other", amountMinorUnits: "1", currency: "BDT", description: "x" }),
    allowed: ["customer"],
  },
  { name: "read audit log", method: "GET", url: () => "/audit/events", allowed: ["security_admin", "auditor"] },
  { name: "verify audit chain", method: "GET", url: () => "/audit/verify", allowed: ["security_admin", "auditor"] },
];

describe("role-based access control matrix", () => {
  let t: TestApp;
  let ctx: { customerId: string; accountId: string };
  const tokens = new Map<Role, string>();

  beforeEach(async () => {
    t = await createTestApp();
    const owner = await t.customer("Owner");
    const operator = await t.staff("operator");
    const account = (
      await t.app.inject({
        method: "POST",
        url: "/accounts",
        headers: t.bearer(operator.token),
        payload: { ownerCustomerId: owner.customer.id, currency: "BDT" },
      })
    ).json();
    ctx = { customerId: owner.customer.id, accountId: account.id };
    tokens.set("customer", owner.token);
    for (const role of ["operator", "security_admin", "auditor"] as const) tokens.set(role, (await t.staff(role)).token);
  });

  for (const endpoint of endpoints) {
    it(`${endpoint.name}: only ${endpoint.allowed.join(", ")} pass the permission check`, async () => {
      for (const role of ROLES) {
        const res = await t.app.inject({
          method: endpoint.method,
          url: endpoint.url(ctx),
          headers: { authorization: `Bearer ${tokens.get(role)}`, ...(endpoint.headers ?? {}) },
          ...(endpoint.payload ? { payload: endpoint.payload(ctx) as object } : {}),
        });
        const reachedHandler = res.statusCode !== 401 && res.statusCode !== 403;
        assert.strictEqual(
          reachedHandler,
          endpoint.allowed.includes(role),
          `${role} -> ${endpoint.method} ${endpoint.url(ctx)} returned ${res.statusCode}: ${res.body}`,
        );
      }
    });
  }

  it("audits every permission denial with the actor, role and attempted permission", async () => {
    await t.app.inject({ method: "GET", url: "/audit/events", headers: t.bearer(tokens.get("customer")!) });
    const denied = (await t.stores.audit.listAscending(0, 1000)).filter((e) => e.action === "authz.denied");
    assert.ok(denied.length >= 1);
    const last = denied[denied.length - 1]!;
    assert.strictEqual(last.actorRole, "customer");
    assert.strictEqual(last.outcome, "denied");
    assert.strictEqual((last.details as { permission: string }).permission, "audit:read");
  });

  it("lets a security admin disable and re-enable a user, immediately cutting off access", async () => {
    const victim = await t.customer("Victim");
    const admin = tokens.get("security_admin")!;
    const disable = await t.app.inject({ method: "POST", url: `/users/${victim.user.id}/disable`, headers: t.bearer(admin) });
    assert.strictEqual(disable.statusCode, 200);
    assert.strictEqual(disable.json().status, "disabled");
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/auth/me", headers: t.bearer(victim.token) })).statusCode, 401);

    const enable = await t.app.inject({ method: "POST", url: `/users/${victim.user.id}/enable`, headers: t.bearer(admin) });
    assert.strictEqual(enable.json().status, "active");
    assert.strictEqual((await t.login(victim.user.email)).statusCode, 200);
  });

  it("stops an administrator disabling their own account", async () => {
    const admin = await t.staff("security_admin");
    const res = await t.app.inject({ method: "POST", url: `/users/${admin.user.id}/disable`, headers: t.bearer(admin.token) });
    assert.strictEqual(res.statusCode, 403);
  });

  it("only lets a security admin create staff, and never a customer-role user via that route", async () => {
    const admin = tokens.get("security_admin")!;
    const ok = await t.app.inject({
      method: "POST",
      url: "/users",
      headers: t.bearer(admin),
      payload: { email: "new.operator@bank.test", role: "operator", password: "a-very-long-passphrase-1" },
    });
    assert.strictEqual(ok.statusCode, 201);
    assert.strictEqual(ok.json().mustChangePassword, true);
    const asCustomer = await t.app.inject({
      method: "POST",
      url: "/users",
      headers: t.bearer(admin),
      payload: { email: "x@bank.test", role: "customer", password: "a-very-long-passphrase-1" },
    });
    assert.strictEqual(asCustomer.statusCode, 400);
  });

  it("rejects duplicate emails with a 409", async () => {
    const admin = tokens.get("security_admin")!;
    const body = { email: "dup@bank.test", role: "auditor", password: "a-very-long-passphrase-1" };
    await t.app.inject({ method: "POST", url: "/users", headers: t.bearer(admin), payload: body });
    const again = await t.app.inject({ method: "POST", url: "/users", headers: t.bearer(admin), payload: body });
    assert.strictEqual(again.statusCode, 409);
    assert.strictEqual(again.json().error.code, "EMAIL_ALREADY_REGISTERED");
  });

  it("refuses weak initial passwords for new users", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/customers",
      headers: t.bearer(tokens.get("operator")!),
      payload: { fullName: "Weak", email: "weak@bank.test", password: "short" },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error.code, "WEAK_PASSWORD");
  });

  it("scopes a customer's account list to their own accounts and lets staff filter by customer", async () => {
    const other = await t.customer("Other");
    const operator = tokens.get("operator")!;
    await t.app.inject({ method: "POST", url: "/accounts", headers: t.bearer(operator), payload: { ownerCustomerId: other.customer.id, currency: "BDT" } });

    const mine = (await t.app.inject({ method: "GET", url: "/accounts", headers: t.bearer(tokens.get("customer")!) })).json();
    assert.ok(mine.every((a: { ownerCustomerId: string }) => a.ownerCustomerId === ctx.customerId));
    const filtered = (await t.app.inject({ method: "GET", url: `/accounts?customerId=${other.customer.id}`, headers: t.bearer(operator) })).json();
    assert.strictEqual(filtered.length, 1);
    // A customer passing someone else's customerId is still limited to their own accounts.
    const spoof = (await t.app.inject({ method: "GET", url: `/accounts?customerId=${other.customer.id}`, headers: t.bearer(tokens.get("customer")!) })).json();
    assert.ok(spoof.every((a: { ownerCustomerId: string }) => a.ownerCustomerId === ctx.customerId));
  });
});
