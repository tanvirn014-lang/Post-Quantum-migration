"use client";

import { useState } from "react";
import { useLowBalance } from "../../hooks/useLowBalance";

export function AlertBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { accounts } = useLowBalance();

  if (accounts.length === 0 || dismissed) return null;

  return (
    <div className="flex items-center justify-between rounded-md bg-accent-soft border border-subtle px-4 py-3 mb-6">
      <p className="text-sm text-primary">Your current account balance is below ৳1,000. Consider transferring funds in.</p>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-muted hover:text-primary">
        ✕
      </button>
    </div>
  );
}
