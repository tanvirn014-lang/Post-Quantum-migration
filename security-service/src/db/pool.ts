import pg from "pg";

const { Pool } = pg;

export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new Pool({ connectionString, max });
}

/** Runs `fn` inside one database transaction, rolling back on any error. */
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Creates `name` on the server `adminUrl` points at, if it does not exist yet. */
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

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}
