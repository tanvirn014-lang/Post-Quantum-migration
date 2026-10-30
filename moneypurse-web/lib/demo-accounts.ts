/**
 * ledger-service has no "list accounts for a customer" endpoint, so this demo UI is wired
 * to two specific accounts created once by `ledger-service/scripts/seed-demo.ts` against the
 * local Postgres. Re-run that script and update these ids if the local database is reset.
 */
export const DEMO_CUSTOMER_ACCOUNTS = {
  primary: "acc_f2a18671-b77b-489e-a189-8351f3193a67",
  savings: "acc_5d436abd-efb9-4ea9-bc78-24f6131516f7",
};
