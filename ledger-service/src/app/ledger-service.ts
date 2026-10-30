import type { Account, Posting, PostingInput, Transaction, TransactionInput } from "../domain/ledger.js";
import type { CreateAccountInput, LedgerStore } from "../ports/ledger-store.js";

export interface TransferInput {
  idempotencyKey: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinorUnits: bigint;
  currency: string;
  description: string;
  metadata?: Record<string, unknown>;
}

/**
 * Thin application-layer facade over a LedgerStore. It adds use-cases built from the
 * primitive postTransaction operation (transfer = a two-leg transaction) but deliberately
 * does not duplicate the store's invariant checks - those live in one place (the domain
 * layer + the store's atomic unit of work) so there is exactly one source of truth for
 * "is this transaction valid".
 */
export class LedgerService {
  constructor(private readonly store: LedgerStore) {}

  createAccount(input: CreateAccountInput): Promise<Account> {
    return this.store.createAccount(input);
  }

  getAccount(accountId: string): Promise<Account | null> {
    return this.store.getAccount(accountId);
  }

  postTransaction(input: TransactionInput): Promise<Transaction> {
    return this.store.postTransaction(input);
  }

  transfer(params: TransferInput): Promise<Transaction> {
    const postings: PostingInput[] = [
      { accountId: params.fromAccountId, amountMinorUnits: -params.amountMinorUnits, currency: params.currency },
      { accountId: params.toAccountId, amountMinorUnits: params.amountMinorUnits, currency: params.currency },
    ];
    return this.store.postTransaction({
      idempotencyKey: params.idempotencyKey,
      description: params.description,
      postings,
      ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
    });
  }

  getTransaction(transactionId: string): Promise<{ transaction: Transaction; postings: Posting[] } | null> {
    return this.store.getTransactionWithPostings(transactionId);
  }

  listPostingsForAccount(accountId: string, opts?: { limit?: number }): Promise<Posting[]> {
    return this.store.listPostingsForAccount(accountId, opts);
  }
}
