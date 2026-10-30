import { randomUUID } from "node:crypto";

/**
 * Stripe-style prefixed ids, generated in the application layer so every LedgerStore
 * implementation produces identical id shapes - a caller must never be able to tell which
 * adapter is behind the interface by looking at an id.
 */
export const newAccountId = (): string => `acc_${randomUUID()}`;
export const newTransactionId = (): string => `txn_${randomUUID()}`;
export const newPostingId = (): string => `pst_${randomUUID()}`;
