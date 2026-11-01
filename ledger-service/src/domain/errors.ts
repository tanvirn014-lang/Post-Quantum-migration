export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnbalancedTransactionError extends DomainError {
  constructor(currency: string, netMinorUnits: bigint) {
    super(
      `Transaction postings for ${currency} do not sum to zero (net ${netMinorUnits.toString()})`,
      "UNBALANCED_TRANSACTION",
    );
  }
}

export class SinglePostingTransactionError extends DomainError {
  constructor() {
    super("A transaction requires at least two postings", "SINGLE_POSTING_TRANSACTION");
  }
}

export class AccountNotFoundError extends DomainError {
  constructor(accountId: string) {
    super(`Account ${accountId} does not exist`, "ACCOUNT_NOT_FOUND");
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(accountId: string) {
    super(`Account ${accountId} does not have sufficient funds for this transaction`, "INSUFFICIENT_FUNDS");
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(accountId: string, accountCurrency: string, postingCurrency: string) {
    super(
      `Account ${accountId} is denominated in ${accountCurrency}, cannot post a ${postingCurrency} entry to it`,
      "CURRENCY_MISMATCH",
    );
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  constructor(key: string) {
    super(
      `Idempotency key ${key} was already used for a transaction with a different payload`,
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
}

export class AccountClosedError extends DomainError {
  constructor(accountId: string) {
    super(`Account ${accountId} is closed or frozen`, "ACCOUNT_CLOSED");
  }
}

export class MissingIdempotencyKeyError extends DomainError {
  constructor() {
    super("The Idempotency-Key header is required for this request", "MISSING_IDEMPOTENCY_KEY");
  }
}

export class TransactionNotFoundError extends DomainError {
  constructor(transactionId: string) {
    super(`Transaction ${transactionId} does not exist`, "TRANSACTION_NOT_FOUND");
  }
}

export class SameAccountTransferError extends DomainError {
  constructor() {
    super("Source and destination accounts must differ", "SAME_ACCOUNT_TRANSFER");
  }
}

export class TransactionNotReversibleError extends DomainError {
  constructor(transactionId: string) {
    super(`Transaction ${transactionId} cannot be reversed (it does not exist in a reversible state or is already reversed)`, "TRANSACTION_NOT_REVERSIBLE");
  }
}
