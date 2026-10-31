"use client";

import { formatCurrency } from "../../lib/format";
import { accountLabels, customerFacingAccounts, totalBalance } from "../../lib/accounts";
import { useAccounts, type Account } from "../../hooks/useAccounts";
import { DashboardWidget } from "./DashboardWidget";
import { EmptyState } from "../ui/QueryState";

function AccountCard({ label, account }: { label: string; account: Account }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-overlay p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-2xl font-semibold text-primary">{formatCurrency(account.balanceMinorUnits, account.currency)}</span>
      {account.status !== "active" && <span className="text-xs text-red-300 capitalize">{account.status}</span>}
    </div>
  );
}

/** One card per live account the signed-in customer owns, plus a total when it is meaningful. */
export function AccountSummaryCards({
  editMode,
  hidden,
  onToggleHidden,
}: {
  editMode: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const query = useAccounts();
  const accounts = customerFacingAccounts(query.data ?? []);
  const labels = accountLabels(accounts);
  const total = accounts.length > 1 ? totalBalance(accounts) : null;

  return (
    <DashboardWidget
      id="accounts"
      title="Accounts"
      editMode={editMode}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      query={{ isLoading: query.isLoading, isError: query.isError, refetch: () => void query.refetch() }}
    >
      {accounts.length === 0 ? (
        <EmptyState title="No accounts yet">A bank operator opens accounts for customers.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {accounts.map((a) => (
              <AccountCard key={a.id} label={labels.get(a.id) ?? a.kind} account={a} />
            ))}
          </div>
          {total && (
            <div className="mt-4 flex items-center justify-between border-t border-subtle pt-3 text-sm">
              <span className="text-muted">Total</span>
              <span className="font-semibold text-primary">{formatCurrency(total.minorUnits, total.currency)}</span>
            </div>
          )}
        </>
      )}
    </DashboardWidget>
  );
}
