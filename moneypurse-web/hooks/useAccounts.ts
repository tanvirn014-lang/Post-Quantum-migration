import { useQuery } from "@tanstack/react-query";
import { getAccount } from "../lib/api/ledger-client";

export function useAccount(accountId: string) {
  return useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getAccount(accountId),
  });
}
