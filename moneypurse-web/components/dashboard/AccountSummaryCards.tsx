"use client";

import { DEMO_CUSTOMER_ACCOUNTS } from "../../lib/demo-accounts";
import { formatCurrency } from "../../lib/format";
import { useAccount } from "../../hooks/useAccounts";
import type { Account } from "../../lib/api/types";
import { DashboardWidget } from "./DashboardWidget";

function AccountCard({ label, data }: { label: string; data: Account }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-overlay p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-semibold text-primary">{formatCurrency(data.balanceMinorUnits, data.currency)}</span>
    </div>
  );
}

// Sums every loaded account's balance in minor units. Assumes one shared currency, true of
// both demo accounts (BDT) - a mixed-currency total would be meaningless, so there's
// deliberately nowhere here to express one.
function sumBalances(accounts: Pick<Account, "balanceMinorUnits" | "currency">[]): Pick<Account, "balanceMinorUnits" | "currency"> {
  const currency = accounts[0]!.currency;
  const total = accounts.reduce((sum, a) => sum + BigInt(a.balanceMinorUnits), 0n);
  return { balanceMinorUnits: total.toString(), currency };
}

export function AccountSummaryCards({
  editMode,
  hidden,
  onToggleHidden,
}: {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const primary = useAccount(DEMO_CUSTOMER_ACCOUNTS.primary);
  const savings = useAccount(DEMO_CUSTOMER_ACCOUNTS.savings);
  const queries = [primary, savings];
  const loaded = queries.map((q) => q.data).filter((d): d is Account => d !== undefined);
  const total = loaded.length > 1 ? sumBalances(loaded) : null;

  return (
    <DashboardWidget
      id="accounts"
      title="Accounts"
      editMode={editMode}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      query={{
        isLoading: queries.some((q) => q.isLoading),
        isError: queries.some((q) => q.isError),
        refetch: () => queries.forEach((q) => q.refetch()),
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {primary.data && <AccountCard label="Primary" data={primary.data} />}
        {savings.data && <AccountCard label="Savings" data={savings.data} />}
      </div>
      {total && (
        <div className="mt-4 flex items-center justify-between border-t border-subtle pt-3 text-sm">
          <span className="text-muted">Total</span>
          <span className="font-semibold text-primary">{formatCurrency(total.balanceMinorUnits, total.currency)}</span>
        </div>
      )}
    </DashboardWidget>
  );
}
