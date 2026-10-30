"use client";

import { AppShell } from "../../components/layout/AppShell";
import { AccountSummaryCards } from "../../components/dashboard/AccountSummaryCards";

// Edit-mode/hide wiring (via useDashboardLayout) lands in Task 19; until then every widget
// gets static defaults (always visible, not in edit mode) so each one can be built and
// visually verified independently.
export default function DashboardPage() {
  return (
    <AppShell>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AccountSummaryCards editMode={false} hidden={false} onToggleHidden={() => {}} />
      </div>
    </AppShell>
  );
}
