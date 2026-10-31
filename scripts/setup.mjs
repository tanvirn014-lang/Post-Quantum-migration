#!/usr/bin/env node
// Idempotent local setup: creates per-service .env files and generates the secrets they need.
// Existing files are never overwritten, so re-running is safe. Secrets are written with
// owner-only permissions and are git-ignored.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hex = (bytes) => randomBytes(bytes).toString("hex");

function writeOnce(file, contents, mode = 0o600) {
  if (existsSync(file)) {
    console.log(`keep   ${path.relative(root, file)} (already exists)`);
    return false;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, { mode });
  console.log(`create ${path.relative(root, file)}`);
  return true;
}

// --- ledger-service -------------------------------------------------------------------
const ledger = path.join(root, "ledger-service");
writeOnce(
  path.join(ledger, ".secrets", "jwt-ed25519.pem"),
  generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
);
const example = readFileSync(path.join(ledger, ".env.example"), "utf8");
writeOnce(path.join(ledger, ".env"), example.replace("# SIDECAR_ASSERTION_SECRET=", `SIDECAR_ASSERTION_SECRET=${hex(32)}`));

// --- security-service -----------------------------------------------------------------
const security = path.join(root, "security-service");
const securityExample = readFileSync(path.join(security, ".env.example"), "utf8");
writeOnce(
  path.join(security, ".env"),
  securityExample.replace("# SIDECAR_TOKEN=", `SIDECAR_TOKEN=${hex(32)}`).replace("# BENCH_TOKEN=", `BENCH_TOKEN=${hex(32)}`),
);

console.log("\nSetup complete. Next: npm run db:up && npm run migrate && npm run seed");
