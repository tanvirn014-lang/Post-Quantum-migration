import type pg from "pg";
import { assertAccountsPostable, assertBalanced, assertSufficientFunds, computeNewBalances } from "../../domain/ledger.js";
import type { Account, AccountKind, AccountStatus, Posting, Transaction, TransactionInput } from "../../domain/ledger.js";
import { IdempotencyKeyReusedError, TransactionNotFoundError, TransactionNotReversibleError } from "../../domain/errors.js";
import { hashTransactionRequest } from "../../app/idempotency.js";
import { newAccountId, newPostingId, newTransactionId } from "../../domain/ids.js";
import type { BalanceDrift, CreateAccountInput, LedgerStore, ListAccountsOptions, PostTransactionAudit, ReverseTransactionInput } from "../../ports/ledger-store.js";
import { appendAuditEventInTx } from "./audit-append.js";

interface AccountRow {
  id: string;
  owner_customer_id: string;
  currency: string;
  kind: AccountKind;
  status: AccountStatus;
  balance_minor_units: string;
  allow_overdraft: boolean;
  created_at: Date;
}

interface TransactionRow {
  id: string;
  idempotency_key: string;
  request_hash: string;
  description: string;
  status: "posted" | "reversed";
  metadata: Record<string, unknown>;
  posted_at: Date;
}

interface PostingRow {
  id: string;
  transaction_id: string;
  account_id: string;
  amount_minor_units: string;
  currency: string;
  created_at: Date;
}

function mapAccountRow(row: AccountRow): Account {
  return {
    id: row.id,
    ownerCustomerId: row.owner_customer_id,
    currency: row.currency,
    kind: row.kind,
    status: row.status,
    balanceMinorUnits: BigInt(row.balance_minor_units),
    allowOverdraft: row.allow_overdraft,
    createdAt: row.created_at,
  };
}

function mapTransactionRow(row: TransactionRow): Transaction {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    description: row.description,
    status: row.status,
    postedAt: row.posted_at,
    metadata: row.metadata,
  };
}

function mapPostingRow(row: PostingRow): Posting {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    accountId: row.account_id,
    amountMinorUnits: BigInt(row.amount_minor_units),
    currency: row.currency,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr?.code === "23505" && (!constraint || pgErr.constraint === constraint);
}

/**
 * Postgres-backed LedgerStore. Every write path runs inside a single database transaction
 * that locks every account it touches (in a deterministic, sorted order, to avoid
 * deadlocking against a concurrent transfer that touches the same two accounts in the
 * opposite order) before validating balances and committing.
 */
export class PostgresLedgerStore implements LedgerStore {
  constructor(private readonly pool: pg.Pool) {}

  async createAccount(input: CreateAccountInput): Promise<Account> {
    const { rows } = await this.pool.query<AccountRow>(
      `INSERT INTO accounts (id, owner_customer_id, currency, allow_overdraft, kind)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        newAccountId(),
        input.ownerCustomerId,
        input.currency.toUpperCase(),
        input.allowOverdraft ?? false,
        input.kind ?? "current",
      ],
    );
    return mapAccountRow(rows[0]!);
  }

  async getAccount(accountId: string): Promise<Account | null> {
    const { rows } = await this.pool.query<AccountRow>("SELECT * FROM accounts WHERE id = $1", [accountId]);
    return rows[0] ? mapAccountRow(rows[0]) : null;
  }

  async listAccounts(opts?: ListAccountsOptions): Promise<Account[]> {
    const { rows } = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts
       WHERE ($1::uuid IS NULL OR owner_customer_id = $1::uuid)
       ORDER BY created_at, id
       LIMIT $2`,
      [opts?.customerId ?? null, opts?.limit ?? 100],
    );
    return rows.map(mapAccountRow);
  }

  async postTransaction(input: TransactionInput, auditBuilder?: PostTransactionAudit): Promise<Transaction> {
    assertBalanced(input.postings);
    const requestHash = hashTransactionRequest(input);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const accountIds = [...new Set(input.postings.map((p) => p.accountId))].sort();
      const { rows: accountRows } = await client.query<AccountRow>(
        `SELECT * FROM accounts WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
        [accountIds],
      );
      const accountsById = new Map(accountRows.map((r) => [r.id, mapAccountRow(r)]));

      assertAccountsPostable(accountsById, input.postings);
      const newBalances = computeNewBalances(accountsById, input.postings);
      assertSufficientFunds(accountsById, newBalances);

      let transactionRow: TransactionRow;
      try {
        const result = await client.query<TransactionRow>(
          `INSERT INTO transactions (id, idempotency_key, request_hash, description, metadata)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            newTransactionId(),
            input.idempotencyKey,
            requestHash,
            input.description,
            JSON.stringify({ ...(input.metadata ?? {}), ...(input.context ? { context: input.context } : {}) }),
          ],
        );
        transactionRow = result.rows[0]!;
      } catch (err) {
        if (isUniqueViolation(err, "transactions_idempotency_key_key")) {
          await client.query("ROLLBACK");
          return this.resolveIdempotentReplay(input.idempotencyKey, requestHash);
        }
        throw err;
      }

      for (const posting of input.postings) {
        await client.query(
          `INSERT INTO postings (id, transaction_id, account_id, amount_minor_units, currency)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            newPostingId(),
            transactionRow.id,
            posting.accountId,
            posting.amountMinorUnits.toString(),
            posting.currency.toUpperCase(),
          ],
        );
      }

      for (const [accountId, newBalance] of newBalances) {
        await client.query("UPDATE accounts SET balance_minor_units = $1 WHERE id = $2", [
          newBalance.toString(),
          accountId,
        ]);
      }

      const transaction = mapTransactionRow(transactionRow);
      // The audit entry for a posting is written in THIS transaction (after the account row locks
      // are held), so a committed posting always has its audit record - no at-least-once gap.
      if (auditBuilder) {
        await appendAuditEventInTx(client, auditBuilder(transaction), new Date());
      }

      await client.query("COMMIT");
      return transaction;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  private async resolveIdempotentReplay(idempotencyKey: string, requestHash: string): Promise<Transaction> {
    const { rows } = await this.pool.query<TransactionRow>(
      "SELECT * FROM transactions WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(
        `Idempotency key ${idempotencyKey} conflicted on insert but no transaction was found - ` +
          "this points at a concurrent rollback race and should be retried",
      );
    }
    if (row.request_hash !== requestHash) {
      throw new IdempotencyKeyReusedError(idempotencyKey);
    }
    return mapTransactionRow(row);
  }

  async getTransactionWithPostings(
    transactionId: string,
  ): Promise<{ transaction: Transaction; postings: Posting[] } | null> {
    const { rows: txRows } = await this.pool.query<TransactionRow>("SELECT * FROM transactions WHERE id = $1", [
      transactionId,
    ]);
    const txRow = txRows[0];
    if (!txRow) return null;

    const { rows: postingRows } = await this.pool.query<PostingRow>(
      "SELECT * FROM postings WHERE transaction_id = $1 ORDER BY created_at",
      [transactionId],
    );

    return {
      transaction: mapTransactionRow(txRow),
      postings: postingRows.map(mapPostingRow),
    };
  }

  async getTransactionByIdempotencyKey(idempotencyKey: string): Promise<Transaction | null> {
    const { rows } = await this.pool.query<TransactionRow>(
      "SELECT * FROM transactions WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    return rows[0] ? mapTransactionRow(rows[0]) : null;
  }

  async listPostingsForAccount(accountId: string, opts?: { limit?: number }): Promise<Posting[]> {
    const limit = opts?.limit ?? 50;
    const { rows } = await this.pool.query<PostingRow>(
      "SELECT * FROM postings WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2",
      [accountId, limit],
    );
    return rows.map(mapPostingRow);
  }

  async reverseTransaction(input: ReverseTransactionInput, auditBuilder?: PostTransactionAudit): Promise<Transaction> {
    const { originalTransactionId, reason } = input;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the original transaction row so two concurrent reversals cannot both proceed.
      const { rows: origRows } = await client.query<TransactionRow>("SELECT * FROM transactions WHERE id = $1 FOR UPDATE", [originalTransactionId]);
      const orig = origRows[0];
      if (!orig) throw new TransactionNotFoundError(originalTransactionId);
      if (orig.status !== "posted") throw new TransactionNotReversibleError(originalTransactionId);

      const { rows: postingRows } = await client.query<PostingRow>("SELECT * FROM postings WHERE transaction_id = $1 ORDER BY created_at", [originalTransactionId]);
      const compensating = postingRows.map(mapPostingRow).map((p) => ({ accountId: p.accountId, amountMinorUnits: -p.amountMinorUnits, currency: p.currency }));
      assertBalanced(compensating);

      const accountIds = [...new Set(compensating.map((p) => p.accountId))].sort();
      const { rows: accountRows } = await client.query<AccountRow>("SELECT * FROM accounts WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE", [accountIds]);
      const accountsById = new Map(accountRows.map((r) => [r.id, mapAccountRow(r)]));
      assertAccountsPostable(accountsById, compensating);
      const newBalances = computeNewBalances(accountsById, compensating);
      assertSufficientFunds(accountsById, newBalances);

      const context = { reverses: originalTransactionId, reason };
      const requestHash = hashTransactionRequest({ description: `Reversal of ${originalTransactionId}`, postings: compensating });
      let reversalRow: TransactionRow;
      try {
        const result = await client.query<TransactionRow>(
          `INSERT INTO transactions (id, idempotency_key, request_hash, description, metadata)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [newTransactionId(), `reverse:${originalTransactionId}`, requestHash, `Reversal of ${originalTransactionId}: ${reason}`, JSON.stringify({ context })],
        );
        reversalRow = result.rows[0]!;
      } catch (err) {
        // A reversal already exists for this original (unique idempotency key) - it is already reversed.
        if (isUniqueViolation(err, "transactions_idempotency_key_key")) throw new TransactionNotReversibleError(originalTransactionId);
        throw err;
      }

      for (const posting of compensating) {
        await client.query("INSERT INTO postings (id, transaction_id, account_id, amount_minor_units, currency) VALUES ($1, $2, $3, $4, $5)", [
          newPostingId(),
          reversalRow.id,
          posting.accountId,
          posting.amountMinorUnits.toString(),
          posting.currency.toUpperCase(),
        ]);
      }
      for (const [accountId, newBalance] of newBalances) {
        await client.query("UPDATE accounts SET balance_minor_units = $1 WHERE id = $2", [newBalance.toString(), accountId]);
      }
      await client.query("UPDATE transactions SET status = 'reversed' WHERE id = $1", [originalTransactionId]);

      const reversal = mapTransactionRow(reversalRow);
      if (auditBuilder) {
        await appendAuditEventInTx(client, auditBuilder(reversal), new Date());
      }
      await client.query("COMMIT");
      return reversal;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async reconcileBalances(): Promise<BalanceDrift[]> {
    const { rows } = await this.pool.query<{ id: string; stored: string; derived: string | null }>(
      `SELECT a.id,
              a.balance_minor_units AS stored,
              COALESCE(SUM(p.amount_minor_units), 0) AS derived
       FROM accounts a
       LEFT JOIN postings p ON p.account_id = a.id
       GROUP BY a.id, a.balance_minor_units
       HAVING a.balance_minor_units <> COALESCE(SUM(p.amount_minor_units), 0)`,
    );
    return rows.map((r) => ({
      accountId: r.id,
      storedBalanceMinorUnits: BigInt(r.stored),
      derivedBalanceMinorUnits: BigInt(r.derived ?? "0"),
    }));
  }
}
