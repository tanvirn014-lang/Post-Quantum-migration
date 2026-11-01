import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { PostgresIdentityStore } from "../../src/adapters/postgres/identity-store.js";
import { DevKms } from "../../src/crypto/kms.js";
import type { KeyManagementService } from "../../src/crypto/kms.js";
import { INTEGRATION_DATABASE_URL, resetTestDatabase, setupTestDatabase } from "../helpers/pg-test-db.js";

const DATABASE_URL = INTEGRATION_DATABASE_URL;

describe(
  "PostgresIdentityStore PII encryption at rest (integration)",
  { skip: DATABASE_URL ? false : "set DATABASE_URL to run this against a real Postgres - see docker-compose.yml" },
  () => {
    let pool: pg.Pool;
    const masterKey = randomBytes(32);

    before(async () => {
      pool = await setupTestDatabase();
    });
    beforeEach(async () => {
      await resetTestDatabase(pool);
    });
    after(async () => {
      await pool.end();
    });

    it("stores full_name as ciphertext at rest but returns plaintext on read", async () => {
      const store = new PostgresIdentityStore(pool, new DevKms(masterKey));
      const created = await store.createCustomer({ fullName: "Ayesha Rahman", email: "ayesha-kms@example.com" });
      assert.equal(created.fullName, "Ayesha Rahman", "create returns plaintext");

      const { rows } = await pool.query<{ full_name: string }>("SELECT full_name FROM customers WHERE id = $1", [created.id]);
      assert.notEqual(rows[0]!.full_name, "Ayesha Rahman", "stored value is not the plaintext");
      assert.doesNotMatch(rows[0]!.full_name, /Ayesha/, "plaintext does not appear at rest");

      assert.equal((await store.getCustomer(created.id))?.fullName, "Ayesha Rahman", "getCustomer decrypts");
      assert.equal((await store.findCustomerByEmail("ayesha-kms@example.com"))?.fullName, "Ayesha Rahman", "findByEmail decrypts");
      assert.ok((await store.listCustomers()).some((c) => c.fullName === "Ayesha Rahman"), "listCustomers decrypts");
    });

    it("fails closed with the wrong master key (PII cannot be read)", async () => {
      const created = await new PostgresIdentityStore(pool, new DevKms(masterKey)).createCustomer({ fullName: "Imran", email: "imran-kms@example.com" });
      const wrongKey = new PostgresIdentityStore(pool, new DevKms(randomBytes(32)));
      await assert.rejects(() => wrongKey.getCustomer(created.id));
    });

    it("supports master-key rotation: a record written under the old key still reads after rotation", async () => {
      const k1 = randomBytes(32);
      const k2 = randomBytes(32);
      const created = await new PostgresIdentityStore(pool, new DevKms(k1)).createCustomer({ fullName: "Rotated", email: "rot-kms@example.com" });
      const rotated = new PostgresIdentityStore(pool, new DevKms(k2, [k1]));
      assert.equal((await rotated.getCustomer(created.id))?.fullName, "Rotated");
    });

    it("fails closed on write when the KMS is unavailable (no plaintext persisted)", async () => {
      const brokenKms: KeyManagementService = {
        async encrypt() {
          throw new Error("kms down");
        },
        async decrypt() {
          throw new Error("kms down");
        },
      };
      const store = new PostgresIdentityStore(pool, brokenKms);
      await assert.rejects(() => store.createCustomer({ fullName: "Nope", email: "nope-kms@example.com" }));
      const { rows } = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM customers WHERE email = $1", ["nope-kms@example.com"]);
      assert.equal(rows[0]!.n, 0, "nothing persisted when the KMS fails");
    });
  },
);
