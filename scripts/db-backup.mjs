// Logical backup of a PostgreSQL database using pg_dump inside the Postgres container.
// Usage: node scripts/db-backup.mjs [dbName]
// Env:  PG_CONTAINER (default ledger-service-postgres-1), PG_USER (default ledger), DR_DIR (default evidence/dr)
//
// Produces a custom-format (-Fc) dump plus a SHA-256 checksum. This is a development DR primitive;
// production disaster recovery should use pg_basebackup + WAL archiving / PITR and offsite,
// immutable storage (see docs/audits/13_HA_DR.md) - those are deployment controls, not in-repo.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const CONTAINER = process.env.PG_CONTAINER ?? "ledger-service-postgres-1";
const USER = process.env.PG_USER ?? "ledger";
const DB = process.argv[2] ?? "ledger";
const OUT_DIR = process.env.DR_DIR ?? "evidence/dr";

function dockerExec(args, { stdoutTo } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", CONTAINER, ...args], { stdio: ["ignore", stdoutTo ? "pipe" : "inherit", "inherit"] });
    if (stdoutTo) child.stdout.pipe(stdoutTo);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker exec ${args.join(" ")} exited ${code}`))));
  });
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, `${ts}-${DB}.dump`);
const ws = createWriteStream(outFile);
await dockerExec(["pg_dump", "-U", USER, "-Fc", DB], { stdoutTo: ws });
await new Promise((r) => ws.end(r));
const digest = await sha256(outFile);
await writeFile(`${outFile}.sha256`, `${digest}  ${path.basename(outFile)}\n`);
console.log(`backup written: ${outFile}`);
console.log(`sha256: ${digest}`);
