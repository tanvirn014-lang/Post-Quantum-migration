// Single entry point for `node --test` - see the ledger's Task 2 ruling for why this
// aggregator exists instead of pointing node --test at a bare directory.
import "./lib/format.test.js";
import "./lib/parse-amount.test.js";
import "./lib/accounts.test.js";
import "./lib/security-format.test.js";
import "./lib/api/api-client.test.js";
import "./lib/api/ledger-client.test.js";
import "./lib/api/ledger-client-factory.test.js";
import "./lib/auth/session.test.js";
import "./lib/auth/routing.test.js";
import "./lib/categorize.test.js";
import "./hooks/useAccounts.test.js";
import "./hooks/useDashboardLayout.test.js";
import "./hooks/useTransactions.test.js";
import "./components/dashboard/DashboardWidget.test.js";
import "./components/dashboard/AccountSummaryCards.test.js";
import "./components/dashboard/TransferWidget.test.js";
import "./components/dashboard/honesty.test.js";
import "./components/dashboard/WidgetErrorBoundary.test.js";
import "./components/auth/LoginForm.test.js";
import "./components/security/security-console.test.js";
import "./lib/low-balance.test.js";
import "./lib/aggregate-cash-flow.test.js";
import "./lib/aggregate-by-category.test.js";
