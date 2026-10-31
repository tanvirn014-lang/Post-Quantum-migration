import type { ApiClient } from "./api-client";
import { ledgerApi } from "./clients";
import type { Account, AccountKind, AuditPage, ChainVerification, Customer, Posting, Transaction } from "./types";

export interface PostTransferInput {
  idempotencyKey: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinorUnits: string;
  currency: string;
  description: string;
}

export interface CreateCustomerInput {
  fullName: string;
  email: string;
  password: string;
}

export interface OpenAccountInput {
  ownerCustomerId: string;
  currency: string;
  kind: AccountKind;
  allowOverdraft: boolean;
}

export interface AuditQuery {
  limit?: number;
  beforeSeq?: number;
}

/** Typed ledger-service endpoints over an ApiClient. Authentication, the error envelope and
 *  token refresh are the ApiClient's job; this layer only knows paths and shapes. */
export function createLedgerClient(api: ApiClient) {
  return {
    listAccounts: (opts: { customerId?: string; limit?: number } = {}) =>
      api.get<Account[]>("/accounts", { query: { customerId: opts.customerId, limit: opts.limit } }),

    getAccount: (accountId: string) => api.get<Account>(`/accounts/${encodeURIComponent(accountId)}`),

    listPostings: (accountId: string, limit?: number) =>
      api.get<Posting[]>(`/accounts/${encodeURIComponent(accountId)}/postings`, { query: { limit } }),

    getTransaction: (transactionId: string) =>
      api.get<{ transaction: Transaction; postings: Posting[] }>(`/transactions/${encodeURIComponent(transactionId)}`),

    /** The Idempotency-Key makes a retried submit safe: the same key replays, never double-posts.
     *  amountMinorUnits stays a string end to end. */
    postTransfer: (input: PostTransferInput) =>
      api.post<Transaction>(
        "/transfers",
        {
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amountMinorUnits: input.amountMinorUnits,
          currency: input.currency,
          description: input.description,
        },
        { headers: { "Idempotency-Key": input.idempotencyKey } },
      ),

    listCustomers: () => api.get<Customer[]>("/customers"),

    createCustomer: (input: CreateCustomerInput) => api.post<{ customer: Customer }>("/customers", input),

    openAccount: (input: OpenAccountInput) => api.post<Account>("/accounts", input),

    listAuditEvents: (q: AuditQuery = {}) => api.get<AuditPage>("/audit/events", { query: { limit: q.limit, beforeSeq: q.beforeSeq } }),

    verifyAuditChain: () => api.get<ChainVerification>("/audit/verify"),
  };
}

export type LedgerClient = ReturnType<typeof createLedgerClient>;

export const ledger = createLedgerClient(ledgerApi);

export const getAccount = ledger.getAccount;
export const listPostings = ledger.listPostings;
export const getTransaction = ledger.getTransaction;
export const postTransfer = ledger.postTransfer;
