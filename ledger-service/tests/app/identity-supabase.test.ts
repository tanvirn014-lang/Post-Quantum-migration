import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { MemoryAuditStore } from "../../src/adapters/memory/audit-store.js";
import { MemoryIdentityStore } from "../../src/adapters/memory/identity-store.js";
import { AuditService } from "../../src/app/audit-service.js";
import { IdentityService } from "../../src/app/identity-service.js";
import { testConfig } from "../../src/config.js";
import { InvalidTokenError } from "../../src/identity/errors.js";
import { PasswordHasher } from "../../src/identity/password.js";
import { TokenService } from "../../src/identity/tokens.js";
import type { SupabaseIdentity, SupabaseVerifier } from "../../src/ports/supabase-verifier.js";
import { generateKeyPairSync } from "node:crypto";

/** Maps opaque test tokens to the identity a real verifier would extract. Any other token throws,
 *  exactly as a signature failure would. */
class FakeSupabaseVerifier implements SupabaseVerifier {
  constructor(private readonly byToken: Map<string, SupabaseIdentity>) {}
  async verify(token: string): Promise<SupabaseIdentity> {
    const identity = this.byToken.get(token);
    if (!identity) throw new InvalidTokenError();
    return identity;
  }
}

async function buildService(verifier?: SupabaseVerifier, opts: { autoProvision?: boolean } = {}) {
  const config = testConfig();
  const stores = { identity: new MemoryIdentityStore(), audit: new MemoryAuditStore() };
  const hasher = new PasswordHasher({ logN: 10 });
  const tokens = await TokenService.create({
    privateKeyPem: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    accessTtlSeconds: config.accessTokenTtlSeconds,
  });
  const audit = new AuditService(stores.audit);
  const identity = new IdentityService({
    store: stores.identity,
    tokens,
    hasher,
    audit,
    limits: { maxFailedAttempts: 5, lockMinutes: 15, refreshTtlDays: 7 },
    supabase: verifier,
    supabaseAutoProvision: opts.autoProvision ?? true,
  });
  return { identity, stores, hasher };
}

const ALICE: SupabaseIdentity = {
  supabaseUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "alice@example.com",
  fullName: "Alice Example",
};

describe("IdentityService Supabase authentication", () => {
  it("provisions a local customer on first authentication with a Supabase token", async () => {
    const { identity, stores } = await buildService(new FakeSupabaseVerifier(new Map([["tok-alice", ALICE]])));

    const user = await identity.authenticate("tok-alice");

    assert.equal(user.role, "customer");
    assert.equal(user.email, "alice@example.com");
    assert.equal(user.supabaseUserId, ALICE.supabaseUserId);
    assert.ok(user.customerId, "a customer record is bound");
    const customer = await stores.identity.getCustomer(user.customerId!);
    assert.equal(customer?.fullName, "Alice Example");
    assert.equal(user.mustChangePassword, false);
  });

  it("returns the same user on subsequent authentications (no duplicate provisioning)", async () => {
    const { identity, stores } = await buildService(new FakeSupabaseVerifier(new Map([["tok-alice", ALICE]])));

    const first = await identity.authenticate("tok-alice");
    const second = await identity.authenticate("tok-alice");

    assert.equal(first.id, second.id);
    assert.equal((await stores.identity.listUsers()).length, 1);
    assert.equal((await stores.identity.listCustomers()).length, 1);
  });

  it("audits the provisioning exactly once", async () => {
    const { identity, stores } = await buildService(new FakeSupabaseVerifier(new Map([["tok-alice", ALICE]])));
    await identity.authenticate("tok-alice");
    await identity.authenticate("tok-alice");
    const events = await stores.audit.list({ limit: 50 });
    const provisions = events.filter((e) => e.action === "auth.external_provision");
    assert.equal(provisions.length, 1);
    assert.equal(provisions[0]!.outcome, "success");
  });

  it("links an existing customer account by email instead of creating a second one", async () => {
    const { identity, stores, hasher } = await buildService(new FakeSupabaseVerifier(new Map([["tok-alice", ALICE]])));
    const { user: existing } = await stores.identity.createCustomerWithUser(
      { fullName: "Alice Local", email: "alice@example.com" },
      { email: "alice@example.com", passwordHash: await hasher.hash("whatever-passphrase"), mustChangePassword: false },
    );

    const user = await identity.authenticate("tok-alice");

    assert.equal(user.id, existing.id);
    assert.equal(user.supabaseUserId, ALICE.supabaseUserId);
    assert.equal((await stores.identity.listUsers()).length, 1);
  });

  it("refuses to link a Supabase login to a staff account of the same email", async () => {
    const staffIdentity: SupabaseIdentity = { ...ALICE, email: "operator@bank.test" };
    const { identity, stores, hasher } = await buildService(new FakeSupabaseVerifier(new Map([["tok-staff", staffIdentity]])));
    await stores.identity.createStaffUser({
      email: "operator@bank.test",
      passwordHash: await hasher.hash("whatever-passphrase"),
      role: "operator",
      customerId: null,
      mustChangePassword: false,
    });

    await assert.rejects(() => identity.authenticate("tok-staff"), InvalidTokenError);
  });

  it("rejects an unverifiable Supabase token", async () => {
    const { identity } = await buildService(new FakeSupabaseVerifier(new Map()));
    await assert.rejects(() => identity.authenticate("garbage"), InvalidTokenError);
  });

  it("refuses to provision an unseen Supabase identity when auto-provisioning is disabled", async () => {
    const { identity, stores } = await buildService(new FakeSupabaseVerifier(new Map([["tok-alice", ALICE]])), { autoProvision: false });
    await assert.rejects(() => identity.authenticate("tok-alice"), InvalidTokenError);
    assert.equal((await stores.identity.listUsers()).length, 0, "no customer is created");
    const events = await stores.audit.list({ limit: 50 });
    assert.ok(events.some((e) => e.action === "auth.external_provision_refused"), "the refusal is audited");
  });

  it("still links an existing customer by email even when auto-provisioning is disabled", async () => {
    const { identity, stores, hasher } = await buildService(new FakeSupabaseVerifier(new Map([["tok-alice", ALICE]])), { autoProvision: false });
    const { user: existing } = await stores.identity.createCustomerWithUser(
      { fullName: "Alice Local", email: "alice@example.com" },
      { email: "alice@example.com", passwordHash: await hasher.hash("whatever-passphrase"), mustChangePassword: false },
    );
    const user = await identity.authenticate("tok-alice");
    assert.equal(user.id, existing.id, "the pre-existing customer is linked, not refused");
  });

  it("rejects any token when no Supabase verifier is configured (unchanged local-only behavior)", async () => {
    const { identity } = await buildService(undefined);
    await assert.rejects(() => identity.authenticate("tok-alice"), InvalidTokenError);
  });

  it("still authenticates a local EdDSA token without consulting Supabase", async () => {
    const { identity, stores, hasher } = await buildService(new FakeSupabaseVerifier(new Map()));
    const { user } = await stores.identity.createCustomerWithUser(
      { fullName: "Local Only", email: "local@bank.test" },
      { email: "local@bank.test", passwordHash: await hasher.hash("correct-horse-battery-staple"), mustChangePassword: false },
    );
    const session = await identity.login("local@bank.test", "correct-horse-battery-staple", {});

    const authed = await identity.authenticate(session.accessToken);
    assert.equal(authed.id, user.id);
  });
});
