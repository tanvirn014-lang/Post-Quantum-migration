import { createHash } from "node:crypto";
import type { PostingInput } from "../domain/ledger.js";

/**
 * A stable hash of the parts of a transaction request that must match for a retried
 * idempotency key to be considered "the same request". Sorted so that posting order in
 * the request body doesn't affect the hash.
 */
export function hashTransactionRequest(input: {
  description: string;
  postings: PostingInput[];
  metadata?: Record<string, unknown>;
}): string {
  const canonicalPostings = input.postings
    .map((p) => ({
      accountId: p.accountId,
      amountMinorUnits: p.amountMinorUnits.toString(),
      currency: p.currency.toUpperCase(),
    }))
    .sort((a, b) => {
      if (a.accountId !== b.accountId) return a.accountId.localeCompare(b.accountId);
      return a.amountMinorUnits.localeCompare(b.amountMinorUnits);
    });

  const canonical = JSON.stringify({
    description: input.description,
    postings: canonicalPostings,
    metadata: input.metadata ?? {},
  });

  return createHash("sha256").update(canonical).digest("hex");
}
