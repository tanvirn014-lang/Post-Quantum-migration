/**
 * ledger-service has no "list accounts for a customer" endpoint, so this demo UI is wired
 * to two specific accounts created once by `ledger-service/scripts/seed-demo.ts` against the
 * local Postgres. Re-run that script and update these ids if the local database is reset.
 */
export const DEMO_CUSTOMER_ACCOUNTS = {
  primary: "acc_3eae517e-05d3-4b4d-9cbd-348d704bea9e",
  savings: "acc_d51bc0fa-8b24-4a48-9904-ce5a378cf1ea",
};
