// Mirrors ledger-service's DTOs field-for-field (see ledger-service/src/http/dto.ts's
// toAccountDTO/toTransactionDTO/toPostingDTO). Money crosses the wire as a decimal string in
// minor units, never a number - see the project's Global Constraints.

export interface Account {
  id: string;
  ownerCustomerId: string;
  currency: string;
  status: "active" | "frozen" | "closed";
  balanceMinorUnits: string;
  allowOverdraft: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  idempotencyKey: string;
  description: string;
  status: "posted" | "reversed";
  postedAt: string;
  metadata: Record<string, unknown>;
}

export interface Posting {
  id: string;
  transactionId: string;
  accountId: string;
  amountMinorUnits: string;
  currency: string;
  createdAt: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
