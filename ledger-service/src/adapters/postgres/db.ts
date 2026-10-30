import pg from "pg";

const { Pool } = pg;

export function createPool(): pg.Pool {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to Postgres");
  }
  return new Pool({
    connectionString,
    max: Number(process.env["PG_POOL_MAX"] ?? 10),
  });
}
