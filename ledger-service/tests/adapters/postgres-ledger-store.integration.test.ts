import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { PostgresLedgerStore } from "../../src/adapters/postgres/ledger-store.js";
import { PostgresAuditStore } from "../../src/adapters/postgres/audit-store.js";
import { INTEGRATION_DATABASE_URL, newCustomerId, resetTestDatabase, setupTestDatabase } from "../helpers/pg-test-db.js";
import {
  AccountNotFoundError,
  CurrencyMismatchError,
  IdempotencyKeyReusedError,
  InsufficientFundsError,
} from "../../src/domain/errors.js";

/**
 * Exercises the real SQL this time: row locking, the unique-idempotency-key race, and the
 * database-level balanced-transaction trigger. The in-memory store (tests/app/ledger-service.test.ts)
 * proves the business logic; this proves the Postgres adapter actually implements it correctly.
 *
 * Requires a running Postgres reachable at DATABASE_URL (see docker-compose.yml). The tests use
 * their own `ledger_test` database on that server, so the application's data is never touched:
 *   docker compose up -d
 *   DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger npm test
 * Skipped automatically otherwise.
 */
const DATABASE_URL = INTEGRATION_DATABASE_URL;

describe(
  "PostgresLedgerStore (integration)",
  { skip: DATABASE_URL ? false : "set DATABASE_URL to run this against a real Postgres - see docker-compose.yml" },
  () => {
    let pool: pg.Pool;
    let store: PostgresLedgerStore;

    before(async () => {
      pool = await setupTestDatabase();
    });

    beforeEach(async () => {
      await resetTestDatabase(pool);
      store = new PostgresLedgerStore(pool);
    });

    after(async () => {
      await pool.end();
    });

    async function fundedAccount(amount: bigint, currency = "BDT") {
      const source = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency, allowOverdraft: true });
      const dest = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency });
      await store.postTransaction({
        idempotencyKey: `fund-${dest.id}`,
        description: "test funding",
        postings: [
          { accountId: source.id, amountMinorUnits: -amount, currency },
          { accountId: dest.id, amountMinorUnits: amount, currency },
        ],
      });
      return (await store.getAccount(dest.id))!;
    }

    it("writes the posting's audit event in the same transaction (money-path audit atomicity)", async () => {
      const src = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT", allowOverdraft: true });
      const dest = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT" });
      const audit = new PostgresAuditStore(pool);
      const txn = await store.postTransaction(
        {
          idempotencyKey: `k-${randomUUID()}`,
          description: "pay",
          postings: [
            { accountId: src.id, amountMinorUnits: -2_000n, currency: "BDT" },
            { accountId: dest.id, amountMinorUnits: 2_000n, currency: "BDT" },
          ],
        },
        (t) => ({ action: "transfer.create", resourceType: "transaction", resourceId: t.id, outcome: "success", details: { via: "integration" } }),
      );
      const events = await audit.list({ limit: 10, action: "transfer.create" });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.resourceId, txn.id);
    });

    it("rolls the posting back if the in-transaction audit append throws (all-or-nothing)", async () => {
      const src = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT", allowOverdraft: true });
      const dest = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT" });
      const key = `k-${randomUUID()}`;
      await assert.rejects(
        () =>
          store.postTransaction(
            {
              idempotencyKey: key,
              description: "pay",
              postings: [
                { accountId: src.id, amountMinorUnits: -2_000n, currency: "BDT" },
                { accountId: dest.id, amountMinorUnits: 2_000n, currency: "BDT" },
              ],
            },
            () => {
              throw new Error("audit build failed");
            },
          ),
        /audit build failed/,
      );
      assert.equal(await store.getTransactionByIdempotencyKey(key), null, "no transaction committed");
      assert.equal((await store.getAccount(dest.id))!.balanceMinorUnits, 0n, "target balance untouched");
    });

    it("persists an account with a zero starting balance", async () => {
      const account = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "bdt" });
      assert.strictEqual(account.balanceMinorUnits, 0n);
      assert.strictEqual(account.currency, "BDT");

      const reloaded = await store.getAccount(account.id);
      assert.strictEqual(reloaded?.balanceMinorUnits, 0n);
    });

    it("moves money between two accounts inside one database transaction", async () => {
      const from = await fundedAccount(10_000n);
      const to = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT" });

      const transaction = await store.postTransaction({
        idempotencyKey: randomUUID(),
        description: "rent split",
        postings: [
          { accountId: from.id, amountMinorUnits: -2_500n, currency: "BDT" },
          { accountId: to.id, amountMinorUnits: 2_500n, currency: "BDT" },
        ],
      });

      assert.strictEqual((await store.getAccount(from.id))!.balanceMinorUnits, 7_500n);
      assert.strictEqual((await store.getAccount(to.id))!.balanceMinorUnits, 2_500n);

      const withPostings = await store.getTransactionWithPostings(transaction.id);
      assert.ok(withPostings!.postings[0]!.createdAt instanceof Date);
    });

    it("rolls back the whole transaction when an account would be overdrawn", async () => {
      const from = await fundedAccount(1_000n);
      const to = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT" });

      await assert.rejects(
        () =>
          store.postTransaction({
            idempotencyKey: randomUUID(),
            description: "should fail",
            postings: [
              { accountId: from.id, amountMinorUnits: -5_000n, currency: "BDT" },
              { accountId: to.id, amountMinorUnits: 5_000n, currency: "BDT" },
            ],
          }),
        InsufficientFundsError,
      );

      assert.strictEqual((await store.getAccount(from.id))!.balanceMinorUnits, 1_000n);
      assert.strictEqual((await store.getAccount(to.id))!.balanceMinorUnits, 0n);
    });

    it("replays an idempotent retry via the unique-constraint path instead of double-posting", async () => {
      const from = await fundedAccount(10_000n);
      const to = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT" });
      const idempotencyKey = randomUUID();
      const request = {
        idempotencyKey,
        description: "salary",
        postings: [
          { accountId: from.id, amountMinorUnits: -1_000n, currency: "BDT" },
          { accountId: to.id, amountMinorUnits: 1_000n, currency: "BDT" },
        ],
      };

      const first = await store.postTransaction(request);
      const second = await store.postTransaction(request);

      assert.strictEqual(second.id, first.id);
      assert.strictEqual((await store.getAccount(to.id))!.balanceMinorUnits, 1_000n);
    });

    it("rejects reusing an idempotency key with a different payload", async () => {
      const from = await fundedAccount(10_000n);
      const to = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT" });
      const idempotencyKey = randomUUID();

      await store.postTransaction({
        idempotencyKey,
        description: "salary",
        postings: [
          { accountId: from.id, amountMinorUnits: -1_000n, currency: "BDT" },
          { accountId: to.id, amountMinorUnits: 1_000n, currency: "BDT" },
        ],
      });

      await assert.rejects(
        () =>
          store.postTransaction({
            idempotencyKey,
            description: "salary",
            postings: [
              { accountId: from.id, amountMinorUnits: -2_000n, currency: "BDT" },
              { accountId: to.id, amountMinorUnits: 2_000n, currency: "BDT" },
            ],
          }),
        IdempotencyKeyReusedError,
      );
    });

    it("rejects a posting against an unknown account", async () => {
      const to = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT" });
      await assert.rejects(
        () =>
          store.postTransaction({
            idempotencyKey: randomUUID(),
            description: "bad transfer",
            postings: [
              { accountId: randomUUID(), amountMinorUnits: -100n, currency: "BDT" },
              { accountId: to.id, amountMinorUnits: 100n, currency: "BDT" },
            ],
          }),
        AccountNotFoundError,
      );
    });

    it("rejects a posting whose currency does not match the account's currency", async () => {
      const from = await fundedAccount(10_000n, "BDT");
      const usdAccount = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "USD" });

      await assert.rejects(
        () =>
          store.postTransaction({
            idempotencyKey: randomUUID(),
            description: "cross-currency without FX conversion",
            postings: [
              { accountId: from.id, amountMinorUnits: -100n, currency: "BDT" },
              { accountId: usdAccount.id, amountMinorUnits: 100n, currency: "BDT" },
            ],
          }),
        CurrencyMismatchError,
      );
    });

    it("the database trigger rejects an unbalanced transaction written outside the application layer", async () => {
      const a = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT", allowOverdraft: true });
      const b = await store.createAccount({ ownerCustomerId: await newCustomerId(pool), currency: "BDT" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `INSERT INTO transactions (id, idempotency_key, request_hash, description) VALUES ($1, $2, $3, $4) RETURNING id`,
          [`txn_${randomUUID()}`, randomUUID(), "test-hash", "direct SQL, deliberately unbalanced"],
        );
        const transactionId = rows[0].id;
        await client.query(
          `INSERT INTO postings (id, transaction_id, account_id, amount_minor_units, currency) VALUES ($1, $2, $3, $4, 'BDT')`,
          [`pst_${randomUUID()}`, transactionId, a.id, -500],
        );
        await client.query(
          `INSERT INTO postings (id, transaction_id, account_id, amount_minor_units, currency) VALUES ($1, $2, $3, $4, 'BDT')`,
          [`pst_${randomUUID()}`, transactionId, b.id, 400], // deliberately does not net to zero
        );
        // The balance check runs as a deferred constraint trigger, so it fires here, at COMMIT.
        await assert.rejects(() => client.query("COMMIT"), /not balanced/i);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    });

    it("two concurrent opposite-direction transfers between the same accounts do not deadlock", async () => {
      const a = await fundedAccount(10_000n);
      const b = await fundedAccount(10_000n);

      const [resultAB, resultBA] = await Promise.all([
        store.postTransaction({
          idempotencyKey: randomUUID(),
          description: "A to B",
          postings: [
            { accountId: a.id, amountMinorUnits: -1_000n, currency: "BDT" },
            { accountId: b.id, amountMinorUnits: 1_000n, currency: "BDT" },
          ],
        }),
        store.postTransaction({
          idempotencyKey: randomUUID(),
          description: "B to A",
          postings: [
            { accountId: b.id, amountMinorUnits: -1_000n, currency: "BDT" },
            { accountId: a.id, amountMinorUnits: 1_000n, currency: "BDT" },
          ],
        }),
      ]);

      assert.ok(resultAB.id);
      assert.ok(resultBA.id);
      // Equal and opposite transfers net out: both accounts end up back where they started.
      assert.strictEqual((await store.getAccount(a.id))!.balanceMinorUnits, 10_000n);
      assert.strictEqual((await store.getAccount(b.id))!.balanceMinorUnits, 10_000n);
    });
  },
);
