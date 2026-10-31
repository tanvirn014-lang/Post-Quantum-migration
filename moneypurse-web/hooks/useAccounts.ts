import { useQuery } from "@tanstack/react-query";
import { getAccount, ledger } from "../lib/api/ledger-client";
import { useSession } from "./useSession";

export type { Account, AccountKind } from "../lib/api/types";

/** Every account the signed-in user may see: a customer sees their own, staff see all (capped). */
export function useAccounts() {
  const { user } = useSession();
  return useQuery({
    queryKey: ["accounts", user?.id ?? null],
    queryFn: () => ledger.listAccounts({ limit: 200 }),
    enabled: user !== null,
  });
}

export function useAccount(accountId: string) {
  return useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getAccount(accountId),
  });
}
