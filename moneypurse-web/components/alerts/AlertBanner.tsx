"use client";

import { useState } from "react";
import { DEMO_CUSTOMER_ACCOUNTS } from "../../lib/demo-accounts";
import { useAccount } from "../../hooks/useAccounts";
import { isLowBalance } from "../../lib/low-balance";

// Same threshold as AlertsDropdown - ৳1,000 in minor units.
const LOW_BALANCE_THRESHOLD_MINOR_UNITS = "100000";

export function AlertBanner() {
  const [dismissed, setDismissed] = useState(false);
  const accountQuery = useAccount(DEMO_CUSTOMER_ACCOUNTS.primary);
  const lowBalance = accountQuery.data ? isLowBalance(accountQuery.data.balanceMinorUnits, LOW_BALANCE_THRESHOLD_MINOR_UNITS) : false;

  if (!lowBalance || dismissed) return null;

  return (
    <div className="flex items-center justify-between rounded-lg bg-accent/15 border border-accent/30 px-4 py-3 mb-6">
      <p className="text-sm text-primary">Your balance is below ৳1,000. Consider transferring funds in.</p>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-muted hover:text-primary">
        ✕
      </button>
    </div>
  );
}
