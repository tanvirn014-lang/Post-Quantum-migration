import { useQuery } from "@tanstack/react-query";
import { listPostings } from "../lib/api/ledger-client";

export function usePostings(accountId: string, limit?: number) {
  return useQuery({
    queryKey: ["postings", accountId, limit],
    queryFn: () => listPostings(accountId, limit),
  });
}
