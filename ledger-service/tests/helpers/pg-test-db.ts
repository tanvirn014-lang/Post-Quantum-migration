import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createPool, ensureDatabase, withDatabase } from "../../src/adapters/postgres/db.js";
import { applyMigrations } from "../../src/adapters/postgres/migrate.js";

const TEST_DATABASE = "ledger_test";

/** The server the integration tests talk to; they skip themselves when it is not configured. */
export const INTEGRATION_DATABASE_URL = process.env["DATABASE_URL"];

/**
 * Integration tests run against their own `ledger_test` database on the configured server and
 * wipe it freely. They never touch the database the application (and the demo data) uses.
 */
export async function setupTestDatabase(): Promise<pg.Pool> {
  const adminUrl = INTEGRATION_DATABASE_URL;
  if (!adminUrl) throw new Error("DATABASE_URL is required for integration tests");
  await ensureDatabase(adminUrl, TEST_DATABASE);
  const pool = createPool(withDatabase(adminUrl, TEST_DATABASE));
  await applyMigrations(pool);
  return pool;
}

export async function resetTestDatabase(pool: pg.Pool): Promise<void> {
  // audit_events refuses UPDATE/DELETE/TRUNCATE by design; disable its guards only here.
  await pool.query("ALTER TABLE audit_events DISABLE TRIGGER USER");
  try {
    await pool.query(
      "TRUNCATE postings, transactions, accounts, refresh_tokens, users, customers, audit_events RESTART IDENTITY CASCADE",
    );
  } finally {
    await pool.query("ALTER TABLE audit_events ENABLE TRIGGER USER");
  }
}

/** Inserts a customer row (accounts reference customers) and returns its id. */
export async function newCustomerId(pool: pg.Pool): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO customers (id, full_name, email) VALUES ($1, $2, $3)", [id, "Test Customer", `${id}@test.invalid`]);
  return id;
}
