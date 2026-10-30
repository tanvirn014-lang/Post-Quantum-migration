import type { Account, Posting, Transaction, TransactionInput } from "../domain/ledger.js";

export interface CreateAccountInput {
  ownerCustomerId: string;
  currency: string;
  allowOverdraft?: boolean;
}

/**
 * LedgerStore is the single unit-of-work boundary: creating an account and posting a
 * transaction are each atomic from the caller's perspective, however they are implemented
 * underneath (a single Postgres transaction, an in-memory structure for tests, etc).
 */
export interface LedgerStore {
  createAccount(input: CreateAccountInput): Promise<Account>;
  getAccount(accountId: string): Promise<Account | null>;

  /**
   * Posts a balanced transaction atomically: locks every account referenced, checks
   * currency match and overdraft rules, writes the transaction and its postings, and
   * updates account balances - or does none of it. Idempotent on idempotencyKey: a retry
   * with the same key and an identical payload returns the original result; a retry with
   * the same key and a different payload throws IdempotencyKeyReusedError.
   */
  postTransaction(input: TransactionInput): Promise<Transaction>;

  getTransactionWithPostings(
    transactionId: string,
  ): Promise<{ transaction: Transaction; postings: Posting[] } | null>;

  getTransactionByIdempotencyKey(idempotencyKey: string): Promise<Transaction | null>;

  listPostingsForAccount(accountId: string, opts?: { limit?: number }): Promise<Posting[]>;
}
