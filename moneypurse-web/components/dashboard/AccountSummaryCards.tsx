"use client";

import { DEMO_CUSTOMER_ACCOUNTS } from "../../lib/demo-accounts";
import { formatCurrency } from "../../lib/format";
import { useAccount } from "../../hooks/useAccounts";
import { DashboardWidget } from "./DashboardWidget";

function AccountCard({ accountId, label }: { accountId: string; label: string }) {
  const query = useAccount(accountId);
  if (!query.data) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-overlay p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-semibold text-primary">
        {formatCurrency(query.data.balanceMinorUnits, query.data.currency)}
      </span>
    </div>
  );
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

  return (
    <DashboardWidget
      id="accounts"
      title="Accounts"
      editMode={editMode}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      query={{ isLoading: primary.isLoading, isError: primary.isError, refetch: primary.refetch }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <AccountCard accountId={DEMO_CUSTOMER_ACCOUNTS.primary} label="Primary" />
        <AccountCard accountId={DEMO_CUSTOMER_ACCOUNTS.savings} label="Savings" />
      </div>
    </DashboardWidget>
  );
}
