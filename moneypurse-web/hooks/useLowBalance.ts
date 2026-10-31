import { customerFacingAccounts, lowBalanceAccounts } from "../lib/accounts";
import { useAccounts, type Account } from "./useAccounts";

/** The only customer alert with a real source: derived from live account balances. */
export function useLowBalance(): { accounts: Account[] } {
  const query = useAccounts();
  return { accounts: lowBalanceAccounts(customerFacingAccounts(query.data ?? [])) };
}
