"use client";

import { useLowBalance } from "../../hooks/useLowBalance";
import { Dropdown } from "../ui/Dropdown";
import { Badge } from "../ui/Badge";

/** Only alerts with a real source appear here. Low balance is computed from live balances;
 *  there is no fraud or bill-reminder backend, so those fixture alerts were removed. */
export function AlertsDropdown() {
  const { accounts } = useLowBalance();
  const count = accounts.length;

  return (
    <Dropdown
      trigger={
        <button
          type="button"
          aria-label={count > 0 ? `Alerts (${count})` : "Alerts"}
          className="relative h-9 w-9 flex items-center justify-center rounded-full bg-surface-overlay text-muted hover:text-primary"
        >
          🔔
          {count > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-accent text-[10px] text-on-accent flex items-center justify-center">
              {count}
            </span>
          )}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <div key={a.id} className="rounded-lg bg-surface-base p-3 text-sm">
            <Badge tone="danger">Low balance</Badge>
            <p className="text-primary mt-1">Your current account balance is below ৳1,000.</p>
          </div>
        ))}
        {count === 0 && <p className="text-sm text-muted px-1 py-2">No alerts.</p>}
      </div>
    </Dropdown>
  );
}
