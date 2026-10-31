import type { Account, Posting, Transaction } from "../domain/ledger.js";

/**
 * JSON has no bigint type, and Fastify's serializer throws on one, so every minor-units
 * field crosses the wire as a decimal string. Clients must treat it as an opaque integer
 * string, never parse it with Number().
 */
export function toAccountDTO(account: Account) {
  return {
    id: account.id,
    ownerCustomerId: account.ownerCustomerId,
    currency: account.currency,
    kind: account.kind,
    status: account.status,
    balanceMinorUnits: account.balanceMinorUnits.toString(),
    allowOverdraft: account.allowOverdraft,
    createdAt: account.createdAt.toISOString(),
  };
}

export function toTransactionDTO(transaction: Transaction) {
  return {
    id: transaction.id,
    idempotencyKey: transaction.idempotencyKey,
    description: transaction.description,
    status: transaction.status,
    postedAt: transaction.postedAt.toISOString(),
    metadata: transaction.metadata,
  };
}

export function toPostingDTO(posting: Posting) {
  return {
    id: posting.id,
    transactionId: posting.transactionId,
    accountId: posting.accountId,
    amountMinorUnits: posting.amountMinorUnits.toString(),
    currency: posting.currency,
    createdAt: posting.createdAt.toISOString(),
  };
}
