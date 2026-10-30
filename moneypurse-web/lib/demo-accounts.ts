/**
 * ledger-service has no "list accounts for a customer" endpoint, so this demo UI is wired
 * to two specific accounts created once by `ledger-service/scripts/seed-demo.ts` against the
 * local Postgres. Re-run that script and update these ids if the local database is reset.
 */
export const DEMO_CUSTOMER_ACCOUNTS = {
  primary: "acc_7917d61a-cbdd-4e86-bc28-9cfefa53a8d9",
  savings: "acc_ab769c32-fbc6-4593-a83e-e7bb4b9853f5",
};
