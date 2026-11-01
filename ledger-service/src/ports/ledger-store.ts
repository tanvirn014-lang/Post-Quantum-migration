import type { Account, AccountKind, Posting, Transaction, TransactionInput } from "../domain/ledger.js";
import type { NewAuditEvent } from "../audit/chain.js";

/** Builds the audit event for a posting from the transaction the store just created. Invoked
 *  INSIDE the posting's unit of work (only for a real posting, never an idempotent replay), so the
 *  posting and its audit entry commit atomically. */
export type PostTransactionAudit = (transaction: Transaction) => NewAuditEvent;

export interface CreateAccountInput {
  ownerCustomerId: string;
  currency: string;
  allowOverdraft?: boolean;
  kind?: AccountKind;
}

export interface ListAccountsOptions {
  customerId?: string;
  limit?: number;
}

/**
 * LedgerStore is the single unit-of-work boundary: creating an account and posting a
 * transaction are each atomic from the caller's perspective, however they are implemented
 * underneath (a single Postgres transaction, an in-memory structure for tests, etc).
 */
export interface LedgerStore {
  createAccount(input: CreateAccountInput): Promise<Account>;
  getAccount(accountId: string): Promise<Account | null>;
  listAccounts(opts?: ListAccountsOptions): Promise<Account[]>;

  /**
   * Posts a balanced transaction atomically: locks every account referenced, checks
   * currency match and overdraft rules, writes the transaction and its postings, and
   * updates account balances - or does none of it. Idempotent on idempotencyKey: a retry
   * with the same key and an identical payload returns the original result; a retry with
   * the same key and a different payload throws IdempotencyKeyReusedError.
   */
  postTransaction(input: TransactionInput, audit?: PostTransactionAudit): Promise<Transaction>;

  getTransactionWithPostings(
    transactionId: string,
  ): Promise<{ transaction: Transaction; postings: Posting[] } | null>;

  getTransactionByIdempotencyKey(idempotencyKey: string): Promise<Transaction | null>;

  listPostingsForAccount(accountId: string, opts?: { limit?: number }): Promise<Posting[]>;
}
