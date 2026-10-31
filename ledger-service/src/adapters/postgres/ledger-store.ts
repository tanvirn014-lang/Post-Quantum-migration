import type pg from "pg";
import { assertAccountsPostable, assertBalanced, assertSufficientFunds, computeNewBalances } from "../../domain/ledger.js";
import type { Account, AccountKind, AccountStatus, Posting, Transaction, TransactionInput } from "../../domain/ledger.js";
import { IdempotencyKeyReusedError } from "../../domain/errors.js";
import { hashTransactionRequest } from "../../app/idempotency.js";
import { newAccountId, newPostingId, newTransactionId } from "../../domain/ids.js";
import type { CreateAccountInput, LedgerStore, ListAccountsOptions } from "../../ports/ledger-store.js";

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

  async postTransaction(input: TransactionInput): Promise<Transaction> {
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

      await client.query("COMMIT");
      return mapTransactionRow(transactionRow);
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
}
