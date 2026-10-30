"use client";

import { AppShell } from "../../components/layout/AppShell";
import { AccountSummaryCards } from "../../components/dashboard/AccountSummaryCards";
import { CashFlowChart } from "../../components/dashboard/CashFlowChart";
import { SpendingByCategoryChart } from "../../components/dashboard/SpendingByCategoryChart";
import { SavingsPotsWidget } from "../../components/dashboard/SavingsPotsWidget";
import { CardManagementWidget } from "../../components/dashboard/CardManagementWidget";
import { RecentTransactionsWidget } from "../../components/dashboard/RecentTransactionsWidget";

// Edit-mode/hide wiring (via useDashboardLayout) lands in Task 19; until then every widget
// gets static defaults (always visible, not in edit mode) so each one can be built and
// visually verified independently.
const staticWidgetProps = { editMode: false, hidden: false, onToggleHidden: () => {} };

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AccountSummaryCards {...staticWidgetProps} />
        <CashFlowChart {...staticWidgetProps} />
        <SpendingByCategoryChart {...staticWidgetProps} />
        <SavingsPotsWidget {...staticWidgetProps} />
        <CardManagementWidget {...staticWidgetProps} />
        <RecentTransactionsWidget {...staticWidgetProps} />
      </div>
    </AppShell>
  );
}
