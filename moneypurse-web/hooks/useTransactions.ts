import { useQueries, useQuery } from "@tanstack/react-query";
import { getTransaction, listPostings } from "../lib/api/ledger-client";

export function usePostings(accountId: string, limit?: number) {
  return useQuery({
    queryKey: ["postings", accountId, limit],
    queryFn: () => listPostings(accountId, limit),
  });
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
  };
}
