import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PostgresAuditStore } from "../src/adapters/postgres/audit-store.js";
import { createPool } from "../src/adapters/postgres/db.js";
import { PostgresIdentityStore } from "../src/adapters/postgres/identity-store.js";
import { PostgresLedgerStore } from "../src/adapters/postgres/ledger-store.js";
import { AuditService } from "../src/app/audit-service.js";
import { PasswordHasher } from "../src/identity/password.js";
import type { Role } from "../src/identity/roles.js";

/**
 * Operator tool: provisions the demo staff users, two demo customers with accounts, and a
 * treasury account that funds them. Idempotent - existing users are left untouched (their
 * passwords are never reset). Newly generated credentials are written to
 * .secrets/demo-credentials.json (git-ignored) and printed once.
 */

const STAFF: { email: string; role: Exclude<Role, "customer"> }[] = [
  { email: "operator@pq-bank.test", role: "operator" },
  { email: "secadmin@pq-bank.test", role: "security_admin" },
  { email: "auditor@pq-bank.test", role: "auditor" },
];

const CUSTOMERS = [
  { fullName: "Ayesha Rahman", email: "ayesha@pq-bank.test", current: 25_000_000n, savings: 50_000_000n },
  { fullName: "Imran Hossain", email: "imran@pq-bank.test", current: 8_500_000n, savings: 12_000_000n },
];

const CREDENTIALS_PATH = path.resolve(".secrets", "demo-credentials.json");

function generatePassword(): string {
  // 24 chars of URL-safe randomness: far above the policy minimum, easy to paste.
  return randomBytes(18).toString("base64url");
}

async function main(): Promise<void> {
  const pool = createPool();
  try {
    const identity = new PostgresIdentityStore(pool);
    const ledger = new PostgresLedgerStore(pool);
    const audit = new AuditService(new PostgresAuditStore(pool));
    const hasher = new PasswordHasher();

    const existing: Record<string, string> = JSON.parse(await readFile(CREDENTIALS_PATH, "utf8").catch(() => "{}"));
    const created: Record<string, string> = {};

    for (const s of STAFF) {
      if (await identity.findUserByEmail(s.email)) continue;
      const password = generatePassword();
      const user = await identity.createStaffUser({
        email: s.email,
        passwordHash: await hasher.hash(password),
        role: s.role,
        customerId: null,
        mustChangePassword: false,
      });
      created[s.email] = password;
      await audit.record({ action: "seed.user_create", outcome: "success", resourceType: "user", resourceId: user.id, details: { role: s.role } });
    }

    const treasuryEmail = "treasury@pq-bank.invalid";
    const treasury =
      (await identity.listCustomers()).find((c) => c.email === treasuryEmail) ??
      (await identity.createCustomer({ fullName: "Bank Treasury (system)", email: treasuryEmail }));
    const treasuryAccount =
      (await ledger.listAccounts({ customerId: treasury.id })).find((a) => a.kind === "settlement") ??
      (await ledger.createAccount({ ownerCustomerId: treasury.id, currency: "BDT", allowOverdraft: true, kind: "settlement" }));

    for (const c of CUSTOMERS) {
      let customerId = (await identity.listCustomers()).find((x) => x.email === c.email)?.id;
      if (!customerId) {
        const password = generatePassword();
        const { customer, user } = await identity.createCustomerWithUser(
          { fullName: c.fullName, email: c.email },
          { email: c.email, passwordHash: await hasher.hash(password), mustChangePassword: false },
        );
        customerId = customer.id;
        created[c.email] = password;
        await audit.record({ action: "seed.customer_create", outcome: "success", resourceType: "customer", resourceId: customer.id, details: { userId: user.id } });
      }

      const accounts = await ledger.listAccounts({ customerId });
      const current = accounts.find((a) => a.kind === "current") ?? (await ledger.createAccount({ ownerCustomerId: customerId, currency: "BDT", kind: "current" }));
      const savings = accounts.find((a) => a.kind === "savings") ?? (await ledger.createAccount({ ownerCustomerId: customerId, currency: "BDT", kind: "savings" }));

      for (const [account, amount] of [
        [current, c.current],
        [savings, c.savings],
      ] as const) {
        // Deterministic keys make re-running the seed a no-op instead of double-funding.
        await ledger.postTransaction({
          idempotencyKey: `seed-funding-${account.id}`,
          description: account.kind === "savings" ? "Opening deposit" : "Initial funding",
          postings: [
            { accountId: treasuryAccount.id, amountMinorUnits: -amount, currency: "BDT" },
            { accountId: account.id, amountMinorUnits: amount, currency: "BDT" },
          ],
          context: { actor: { userId: null, role: "seed" }, channel: "seed" },
        });
      }
    }

    if (Object.keys(created).length > 0) {
      await mkdir(path.dirname(CREDENTIALS_PATH), { recursive: true });
      await writeFile(CREDENTIALS_PATH, JSON.stringify({ ...existing, ...created }, null, 2), { mode: 0o600 });
      console.log(`New demo credentials written to ${CREDENTIALS_PATH} (git-ignored):`);
      for (const [email, password] of Object.entries(created)) console.log(`  ${email.padEnd(26)} ${password}`);
    } else {
      console.log("Demo data already present; no new users created (existing passwords are never reset).");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
