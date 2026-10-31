import { useQueries, useQuery } from "@tanstack/react-query";
import { getTransaction, listPostings } from "../lib/api/ledger-client";
import type { Posting } from "../lib/api/types";
import { useAccounts } from "./useAccounts";

export function usePostings(accountId: string, limit?: number) {
  return useQuery({
    queryKey: ["postings", accountId, limit],
    queryFn: () => listPostings(accountId, limit),
  });
}

/**
 * Postings across all of the signed-in customer's own accounts (settlement accounts excluded),
 * newest first. Exposes the same loading/error/refetch surface as a single query so widgets
 * can treat it like one.
 */
export function useCustomerPostings(limit: number) {
  const accounts = useAccounts();
  const ids = (accounts.data ?? []).filter((a) => a.kind !== "settlement").map((a) => a.id);
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["postings", id, limit],
      queryFn: () => listPostings(id, limit),
    })),
  });

  const allLoaded = accounts.isSuccess && results.every((r) => r.isSuccess);
  const data: Posting[] | undefined = allLoaded
    ? results
        .flatMap((r) => r.data ?? [])
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    : undefined;

  return {
    data,
    isLoading: accounts.isLoading || results.some((r) => r.isLoading),
    isError: accounts.isError || results.some((r) => r.isError),
    refetch: () => Promise.all([accounts.refetch(), ...results.map((r) => r.refetch())]),
  };
}

/** Fetches each unique transaction once and reduces the results into a description lookup
 *  map, since Posting itself has no description - that lives on its parent Transaction. */
export function useTransactionDescriptions(transactionIds: string[]) {
  const uniqueIds = Array.from(new Set(transactionIds));
  const results = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: ["transaction", id],
      queryFn: () => getTransaction(id),
    })),
  });

  const descriptionsByTransactionId: Record<string, string> = {};
  uniqueIds.forEach((id, i) => {
    const data = results[i]?.data;
    if (data) descriptionsByTransactionId[id] = data.transaction.description;
  });

  return {
    descriptionsByTransactionId,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    // A single query refetch only retries that one transaction - callers that show one
    // combined error/retry state (DashboardWidget) need to retry every underlying query.
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}
