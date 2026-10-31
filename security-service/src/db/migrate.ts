import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createPool, databaseName, ensureDatabase, withDatabase } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled location is dist/src/db/migrate.js; migrations/ sits at the package root.
const migrationsDir = path.resolve(__dirname, "../../../migrations");

export async function applyMigrations(pool: pg.Pool, log: (line: string) => void = console.log): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    log(`apply ${file}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  log("migrations up to date");
}

/** Creates the target database if needed (the `security` database is separate from `ledger`),
 *  then applies pending migrations. */
export async function prepareDatabase(databaseUrl: string): Promise<pg.Pool> {
  const name = databaseName(databaseUrl);
  await ensureDatabase(withDatabase(databaseUrl, "postgres"), name);
  const pool = createPool(databaseUrl);
  await applyMigrations(pool);
  return pool;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exitCode = 1;
  } else {
    prepareDatabase(url)
      .then((pool) => pool.end())
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      });
  }
}
