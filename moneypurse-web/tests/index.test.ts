// Single entry point for `node --test` — see the ledger's Task 2 ruling for why this
// aggregator exists instead of pointing node --test at a bare directory.
import "./lib/format.test.js";
import "./lib/api/ledger-client.test.js";
import "./lib/mock/categorize.test.js";
import "./hooks/useAccounts.test.js";
import "./hooks/useDashboardLayout.test.js";
import "./components/dashboard/DashboardWidget.test.js";
