import {
  AccountClosedError,
  AccountNotFoundError,
  CurrencyMismatchError,
  InsufficientFundsError,
  SinglePostingTransactionError,
  UnbalancedTransactionError,
} from "./errors.js";

export type AccountStatus = "active" | "frozen" | "closed";
export type AccountKind = "current" | "savings" | "settlement";

export interface Account {
  id: string;
  ownerCustomerId: string;
  currency: string;
  kind: AccountKind;
  status: AccountStatus;
  /** Running balance in minor units, maintained transactionally by the ledger service. */
  balanceMinorUnits: bigint;
  allowOverdraft: boolean;
  createdAt: Date;
}

/**
 * A posting moves money into or out of a single account.
 * Convention: positive amountMinorUnits credits (increases) the account,
 * negative amountMinorUnits debits (decreases) the account.
 */
export interface PostingInput {
  accountId: string;
  amountMinorUnits: bigint;
  currency: string;
}

export interface Posting extends PostingInput {
  id: string;
  transactionId: string;
  createdAt: Date;
}

export interface TransactionInput {
  idempotencyKey: string;
  description: string;
  postings: PostingInput[];
  /** Caller-supplied descriptive data. Part of the idempotency request hash. */
  metadata?: Record<string, unknown>;
  /**
   * Server-attested provenance (acting user, channel, correlation id). Stored with the
   * transaction in the same database transaction as the postings, but deliberately excluded
   * from the idempotency request hash: a retry of the same request arrives with a new
   * correlation id and must still replay, not conflict.
   */
  context?: Record<string, unknown>;
}

export type TransactionStatus = "posted" | "reversed";

export interface Transaction {
  id: string;
  idempotencyKey: string;
  description: string;
  status: TransactionStatus;
  postedAt: Date;
  metadata: Record<string, unknown>;
}

/**
 * Enforces the core double-entry invariant: for every currency present in a transaction,
 * the signed postings must net to zero. Throws a DomainError if the transaction is invalid
 * shape, never silently fixes it.
 */
export function assertBalanced(postings: PostingInput[]): void {
  if (postings.length < 2) {
    throw new SinglePostingTransactionError();
  }

  const netByCurrency = new Map<string, bigint>();
  for (const posting of postings) {
    const currency = posting.currency.toUpperCase();
    const running = netByCurrency.get(currency) ?? 0n;
    netByCurrency.set(currency, running + posting.amountMinorUnits);
  }

  for (const [currency, net] of netByCurrency) {
    if (net !== 0n) {
      throw new UnbalancedTransactionError(currency, net);
    }
  }
}

/**
 * The three rules every LedgerStore's postTransaction must apply, in this order, regardless
 * of how it stores data. Pulled out here so the memory and Postgres adapters can't drift
 * apart on what "a valid posting" means - each adapter supplies its own account lookup (a
 * Map snapshot from memory, or the rows a Postgres row-lock just returned) and gets back the
 * same decisions.
 */

/** Every account a posting targets must exist, be active, and match the posting's currency. */
export function assertAccountsPostable(
  accounts: ReadonlyMap<string, Account>,
  postings: readonly PostingInput[],
): void {
  for (const posting of postings) {
    const account = accounts.get(posting.accountId);
    if (!account) throw new AccountNotFoundError(posting.accountId);
    if (account.status !== "active") throw new AccountClosedError(posting.accountId);
    if (account.currency !== posting.currency.toUpperCase()) {
      throw new CurrencyMismatchError(account.id, account.currency, posting.currency);
    }
  }
}

/** Folds a set of postings into each touched account's resulting balance. Call after
 *  assertAccountsPostable so every posting.accountId is guaranteed present in `accounts`. */
export function computeNewBalances(
  accounts: ReadonlyMap<string, Account>,
  postings: readonly PostingInput[],
): Map<string, bigint> {
  const newBalances = new Map<string, bigint>();
  for (const posting of postings) {
    const account = accounts.get(posting.accountId)!;
    const running = newBalances.get(account.id) ?? account.balanceMinorUnits;
    newBalances.set(account.id, running + posting.amountMinorUnits);
  }
  return newBalances;
}

/** Rejects the transaction if it would take any non-overdraft account negative. */
export function assertSufficientFunds(
  accounts: ReadonlyMap<string, Account>,
  newBalances: ReadonlyMap<string, bigint>,
): void {
  for (const [accountId, newBalance] of newBalances) {
    const account = accounts.get(accountId)!;
    if (newBalance < 0n && !account.allowOverdraft) {
      throw new InsufficientFundsError(accountId);
    }
  }
}
