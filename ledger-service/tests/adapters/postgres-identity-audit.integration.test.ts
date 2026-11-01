import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { PostgresAuditStore } from "../../src/adapters/postgres/audit-store.js";
import { PostgresIdentityStore } from "../../src/adapters/postgres/identity-store.js";
import { AuditService } from "../../src/app/audit-service.js";
import { INTEGRATION_DATABASE_URL, resetTestDatabase, setupTestDatabase } from "../helpers/pg-test-db.js";

/**
 * Exercises the SQL behind identity and the audit log: unique emails, atomic customer+user
 * creation, the single-use refresh-token primitive, atomic lockout counting, and - most
 * importantly - that the hash chain stays linear under concurrent writers and that the
 * database itself refuses to edit or delete audit rows.
 */
describe(
  "Postgres identity + audit (integration)",
  { skip: INTEGRATION_DATABASE_URL ? false : "set DATABASE_URL to run this against a real Postgres - see docker-compose.yml" },
  () => {
    let pool: pg.Pool;
    let identity: PostgresIdentityStore;
    let auditStore: PostgresAuditStore;
    let audit: AuditService;

    before(async () => {
      pool = await setupTestDatabase();
    });
    beforeEach(async () => {
      await resetTestDatabase(pool);
      identity = new PostgresIdentityStore(pool);
      auditStore = new PostgresAuditStore(pool);
      audit = new AuditService(auditStore);
    });
    after(async () => {
      await pool.end();
    });

    const staff = (email: string) =>
      identity.createStaffUser({ email, passwordHash: "hash", role: "operator", customerId: null, mustChangePassword: false });

    it("creates a customer and its portal user atomically, and rolls both back on a duplicate email", async () => {
      const email = `ana-${randomUUID().slice(0, 6)}@bank.test`;
      const { customer, user } = await identity.createCustomerWithUser({ fullName: "Ana", email }, { email, passwordHash: "h", mustChangePassword: true });
      assert.strictEqual(user.customerId, customer.id);
      assert.strictEqual(user.role, "customer");

      await assert.rejects(
        identity.createCustomerWithUser({ fullName: "Ana 2", email }, { email, passwordHash: "h", mustChangePassword: true }),
        { code: "EMAIL_ALREADY_REGISTERED" },
      );
      assert.strictEqual((await identity.listCustomers()).length, 1, "the failed attempt must not leave an orphan customer");
    });

    it("enforces unique user emails and the role/customer binding in the database", async () => {
      await staff("op@bank.test");
      await assert.rejects(staff("op@bank.test"), { code: "EMAIL_ALREADY_REGISTERED" });
      await assert.rejects(
        pool.query("INSERT INTO users (id, email, password_hash, role, customer_id) VALUES ($1, $2, 'h', 'customer', NULL)", [randomUUID(), "bad@bank.test"]),
        /users_customer_binding/,
      );
    });

    it("provisions a Supabase-linked customer, finds it by supabase id, and refuses a duplicate id", async () => {
      const supabaseUserId = randomUUID();
      const email = `supa-${randomUUID().slice(0, 6)}@bank.test`;
      const { customer, user } = await identity.provisionExternalCustomer({ supabaseUserId, email, fullName: "Supa User", passwordHash: "unusable" });
      assert.strictEqual(user.role, "customer");
      assert.strictEqual(user.customerId, customer.id);
      assert.strictEqual(user.supabaseUserId, supabaseUserId);

      const found = await identity.findUserBySupabaseId(supabaseUserId);
      assert.strictEqual(found!.id, user.id);
      assert.strictEqual(await identity.findUserBySupabaseId(randomUUID()), null);

      // The partial unique index forbids two local users sharing one Supabase identity.
      await assert.rejects(
        identity.provisionExternalCustomer({ supabaseUserId, email: `other-${randomUUID().slice(0, 6)}@bank.test`, fullName: "Dup", passwordHash: "x" }),
        { code: "EMAIL_ALREADY_REGISTERED" },
      );
      assert.strictEqual((await identity.listUsers()).length, 1, "the failed provision must not leave an orphan user");
    });

    it("links an existing local customer to a Supabase identity", async () => {
      const email = `link-${randomUUID().slice(0, 6)}@bank.test`;
      const { user } = await identity.createCustomerWithUser({ fullName: "Local", email }, { email, passwordHash: "h", mustChangePassword: false });
      assert.strictEqual(user.supabaseUserId, null);

      const supabaseUserId = randomUUID();
      const linked = await identity.linkSupabaseUser(user.id, supabaseUserId);
      assert.strictEqual(linked!.supabaseUserId, supabaseUserId);
      assert.strictEqual((await identity.findUserBySupabaseId(supabaseUserId))!.id, user.id);
    });

    it("counts failures atomically and locks at the threshold", async () => {
      const user = await staff("lock@bank.test");
      const now = new Date();
      await Promise.all(Array.from({ length: 4 }, () => identity.registerLoginFailure(user.id, now, 5, 60_000)));
      assert.strictEqual((await identity.findUserById(user.id))!.failedLoginCount, 4, "no lost updates under concurrency");
      const locked = await identity.registerLoginFailure(user.id, now, 5, 60_000);
      assert.ok(locked!.lockedUntil && locked!.lockedUntil > now);
      assert.strictEqual(locked!.failedLoginCount, 0);
    });

    it("lets exactly one concurrent caller consume a refresh token", async () => {
      const user = await staff("rt@bank.test");
      const id = randomUUID();
      await identity.createRefreshToken({
        id,
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      });
      const results = await Promise.all(Array.from({ length: 8 }, () => identity.consumeRefreshToken(id, new Date())));
      assert.strictEqual(results.filter(Boolean).length, 1);
    });

    it("keeps the audit chain linear and valid when many events are appended concurrently", async () => {
      await Promise.all(Array.from({ length: 25 }, (_, i) => audit.record({ action: "load.test", outcome: "success", details: { i } })));
      const result = await audit.verify();
      assert.strictEqual(result.valid, true, JSON.stringify(result));
      assert.strictEqual(result.eventsChecked, 25);
    });

    it("round-trips event fields so verification survives the database (jsonb, timestamptz)", async () => {
      await audit.record({
        actorUserId: randomUUID(),
        actorRole: "operator",
        action: "roundtrip",
        outcome: "denied",
        ip: "203.0.113.9",
        userAgent: "ünïcode/1.0",
        details: { z: 1, a: { nested: ["x", 2, true, null] }, text: "тест" },
      });
      assert.strictEqual((await audit.verify()).valid, true);
    });

    it("refuses UPDATE, DELETE and TRUNCATE on audit_events at the database level", async () => {
      await audit.record({ action: "immutable.test", outcome: "success" });
      await assert.rejects(pool.query("UPDATE audit_events SET outcome = 'failure'"), /append-only/);
      await assert.rejects(pool.query("DELETE FROM audit_events"), /append-only/);
      await assert.rejects(pool.query("TRUNCATE audit_events"), /append-only/);
    });

    it("detects tampering performed by someone who bypasses the triggers", async () => {
      await audit.record({ action: "a", outcome: "success" });
      await audit.record({ action: "b", outcome: "success" });
      await audit.record({ action: "c", outcome: "success" });
      await pool.query("ALTER TABLE audit_events DISABLE TRIGGER USER");
      try {
        await pool.query("UPDATE audit_events SET outcome = 'failure' WHERE action = 'b'");
      } finally {
        await pool.query("ALTER TABLE audit_events ENABLE TRIGGER USER");
      }
      const result = await audit.verify();
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.brokenAtSeq, 2);
    });
  },
);
