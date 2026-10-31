import pg from "pg";

const { Pool } = pg;

export function createPool(connectionString: string | undefined = process.env["DATABASE_URL"], max = Number(process.env["PG_POOL_MAX"] ?? 10)): pg.Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to Postgres");
  }
  return new Pool({ connectionString, max });
}

/** Creates `name` on the server `adminUrl` points at, if it does not exist yet. Used so
 *  integration tests can run against their own database instead of wiping demo data. */
export async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

/** Returns `url` with its database name replaced. */
export function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}
