import type { Account, AccountKind } from "./api/types";

const KIND_LABEL: Record<AccountKind, string> = {
  current: "Current",
  savings: "Savings",
  settlement: "Settlement",
};

/** Accounts a customer-facing screen should show: the customer own accounts, never settlement ones. */
export function customerFacingAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => a.kind !== "settlement");
}

/** "Current", "Savings" - numbered ("Savings 2") only when a kind appears more than once. */
export function accountLabels(accounts: readonly Account[]): Map<string, string> {
  const totals = new Map<AccountKind, number>();
  for (const a of accounts) totals.set(a.kind, (totals.get(a.kind) ?? 0) + 1);
  const seen = new Map<AccountKind, number>();
  const labels = new Map<string, string>();
  for (const a of accounts) {
    const n = (seen.get(a.kind) ?? 0) + 1;
    seen.set(a.kind, n);
    labels.set(a.id, (totals.get(a.kind) ?? 0) > 1 ? `${KIND_LABEL[a.kind]} ${n}` : KIND_LABEL[a.kind]);
  }
  return labels;
}

/**
 * Sum of balances in minor units (bigint, never a float). Returns null when there is nothing
 * to sum or the accounts are in different currencies - a mixed-currency total is meaningless.
 */
export function totalBalance(accounts: readonly Account[]): { minorUnits: string; currency: string } | null {
  const first = accounts[0];
  if (!first || accounts.some((a) => a.currency !== first.currency)) return null;
  const total = accounts.reduce((sum, a) => sum + BigInt(a.balanceMinorUnits), 0n);
  return { minorUnits: total.toString(), currency: first.currency };
}

/** ৳1,000 in minor units. A product choice, not a regulatory threshold. */
export const LOW_BALANCE_THRESHOLD_MINOR_UNITS = "100000";

/** Current accounts whose live balance is below the threshold. Compared as bigint, never a float. */
export function lowBalanceAccounts(accounts: readonly Account[], thresholdMinorUnits = LOW_BALANCE_THRESHOLD_MINOR_UNITS): Account[] {
  const threshold = BigInt(thresholdMinorUnits);
  return accounts.filter((a) => a.kind === "current" && a.status === "active" && BigInt(a.balanceMinorUnits) < threshold);
}
