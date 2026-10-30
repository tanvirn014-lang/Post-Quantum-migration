"use client";

import { DEMO_CUSTOMER_ACCOUNTS } from "../../lib/demo-accounts";
import { useAccount } from "../../hooks/useAccounts";
import { useAlerts } from "../../hooks/useAlerts";
import { isLowBalance } from "../../lib/low-balance";
import { Dropdown } from "../ui/Dropdown";
import { Badge } from "../ui/Badge";

// ৳1,000 in minor units. Not in the spec - this task's own call (see Task 18's brief).
const LOW_BALANCE_THRESHOLD_MINOR_UNITS = "100000";

export function AlertsDropdown() {
  const accountQuery = useAccount(DEMO_CUSTOMER_ACCOUNTS.primary);
  const alertsQuery = useAlerts(DEMO_CUSTOMER_ACCOUNTS.primary);

  const lowBalance = accountQuery.data ? isLowBalance(accountQuery.data.balanceMinorUnits, LOW_BALANCE_THRESHOLD_MINOR_UNITS) : false;
  const alerts = alertsQuery.data ?? [];
  const count = alerts.length + (lowBalance ? 1 : 0);

  return (
    <Dropdown
      trigger={
        <button
          type="button"
          aria-label="Alerts"
          className="relative h-9 w-9 flex items-center justify-center rounded-full bg-surface-overlay text-muted hover:text-primary"
        >
          🔔
          {count > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-accent text-[10px] text-surface-base flex items-center justify-center">
              {count}
            </span>
          )}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        {lowBalance && (
          <div className="rounded-lg bg-surface-base p-3 text-sm">
            <Badge tone="danger">Low balance</Badge>
            <p className="text-primary mt-1">Your balance is below ৳1,000.</p>
          </div>
        )}
        {alerts.map((alert) => (
          <div key={alert.id} className="rounded-lg bg-surface-base p-3 text-sm">
            <Badge tone={alert.kind === "unusual_spending" ? "warning" : "neutral"}>
              {alert.kind.replace("_", " ")}
            </Badge>
            <p className="text-primary mt-1">{alert.message}</p>
          </div>
        ))}
        {count === 0 && <p className="text-sm text-muted px-1 py-2">No alerts.</p>}
      </div>
    </Dropdown>
  );
}
