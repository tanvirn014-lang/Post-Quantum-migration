// Restore a pg_dump (-Fc) backup into a FRESH database, so the restore is verifiable without
// touching the source. Usage: node scripts/db-restore.mjs <dumpFile> <targetDbName>
// Env: PG_CONTAINER (default ledger-service-postgres-1), PG_USER (default ledger)
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";

const CONTAINER = process.env.PG_CONTAINER ?? "ledger-service-postgres-1";
const USER = process.env.PG_USER ?? "ledger";
const [inFile, target] = process.argv.slice(2);

if (!inFile || !target) {
  console.error("usage: node scripts/db-restore.mjs <dumpFile> <targetDbName>");
  process.exit(1);
}
if (!/^[a-z][a-z0-9_]{0,62}$/.test(target)) {
  console.error("targetDbName must match ^[a-z][a-z0-9_]{0,62}$ (safe identifier)");
  process.exit(1);
}

function dockerExec(args, { stdinFrom } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", ...(stdinFrom ? ["-i"] : []), CONTAINER, ...args], {
      stdio: [stdinFrom ? "pipe" : "ignore", "inherit", "inherit"],
    });
    if (stdinFrom) stdinFrom.pipe(child.stdin);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker exec ${args.join(" ")} exited ${code}`))));
  });
}

// Recreate the target database, then restore into it.
await dockerExec(["psql", "-U", USER, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${target}`, "-c", `CREATE DATABASE ${target}`]);
await dockerExec(["pg_restore", "-U", USER, "-d", target], { stdinFrom: createReadStream(inFile) });
console.log(`restored ${inFile} into database "${target}"`);
