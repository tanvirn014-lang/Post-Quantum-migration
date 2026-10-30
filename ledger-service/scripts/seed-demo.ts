import { randomUUID } from "node:crypto";
import { createPool } from "../src/adapters/postgres/db.js";
import { PostgresLedgerStore } from "../src/adapters/postgres/ledger-store.js";

/**
 * One-time operator tool for moneypurse-web's demo customer: creates a primary (overdraft-
 * allowed) and a savings account, funds the savings account from the primary, and prints
 * both ids. Paste them into moneypurse-web/lib/demo-accounts.ts. Talks to the store directly
 * (not over HTTP) since this is a local seeding tool, not a client of the API.
 */
async function main(): Promise<void> {
  const pool = createPool();
  try {
    const store = new PostgresLedgerStore(pool);
    const customerId = randomUUID();

    const primary = await store.createAccount({
      ownerCustomerId: customerId,
      currency: "BDT",
      allowOverdraft: true,
    });
    const savings = await store.createAccount({
      ownerCustomerId: customerId,
      currency: "BDT",
    });

    await store.postTransaction({
      idempotencyKey: `seed-demo-${customerId}`,
      description: "Initial demo funding",
      postings: [
        { accountId: primary.id, amountMinorUnits: -500000n, currency: "BDT" },
        { accountId: savings.id, amountMinorUnits: 500000n, currency: "BDT" },
      ],
    });

    console.log(`customer:  ${customerId}`);
    console.log(`primary:   ${primary.id}`);
    console.log(`savings:   ${savings.id}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
