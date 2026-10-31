#!/usr/bin/env node
// Idempotent local setup: creates per-service .env files, generates the secrets they need and the
// research PKI. Existing files and keys are never overwritten, so re-running is safe; missing keys
// are appended (so an older .env picks up new settings). Secrets are owner-only and git-ignored.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hex = (bytes) => randomBytes(bytes).toString("hex");
const rel = (file) => path.relative(root, file);

function writeOnce(file, contents, mode = 0o600) {
  if (existsSync(file)) {
    console.log(`keep   ${rel(file)} (already exists)`);
    return false;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, { mode });
  console.log(`create ${rel(file)}`);
  return true;
}

function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}

/** Appends KEY=value for keys the file does not define yet; never changes an existing value. */
function ensureKeys(file, defaults) {
  const present = readEnv(file);
  const missing = Object.entries(defaults).filter(([k]) => !(k in present));
  if (missing.length === 0) return;
  appendFileSync(file, `${readFileSync(file, "utf8").endsWith("\n") ? "" : "\n"}${missing.map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  console.log(`append ${rel(file)}: ${missing.map(([k]) => k).join(", ")}`);
}

// --- ledger-service -------------------------------------------------------------------
const ledger = path.join(root, "ledger-service");
writeOnce(path.join(ledger, ".secrets", "jwt-ed25519.pem"), generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString());
const ledgerExample = readFileSync(path.join(ledger, ".env.example"), "utf8");
writeOnce(path.join(ledger, ".env"), ledgerExample.replace("# SIDECAR_ASSERTION_SECRET=", `SIDECAR_ASSERTION_SECRET=${hex(32)}`));
ensureKeys(path.join(ledger, ".env"), { SIDECAR_ASSERTION_SECRET: hex(32) });

// --- security-service -----------------------------------------------------------------
const security = path.join(root, "security-service");
const securityExample = readFileSync(path.join(security, ".env.example"), "utf8");
writeOnce(path.join(security, ".env"), securityExample.replace("# SIDECAR_TOKEN=", `SIDECAR_TOKEN=${hex(32)}`).replace("# BENCH_TOKEN=", `BENCH_TOKEN=${hex(32)}`));
ensureKeys(path.join(security, ".env"), {
  SIDECAR_TOKEN: hex(32),
  BENCH_TOKEN: hex(32),
  PEER_SIM_URL: "http://127.0.0.1:3300",
  PEER_SIM_TOKEN: hex(32),
});

// --- pqc-sidecar (shares secrets with the two services above) -------------------------
const sidecar = path.join(root, "pqc-sidecar");
const securityEnv = readEnv(path.join(security, ".env"));
const ledgerEnv = readEnv(path.join(ledger, ".env"));
writeOnce(path.join(sidecar, ".env"), readFileSync(path.join(sidecar, ".env.example"), "utf8"));
ensureKeys(path.join(sidecar, ".env"), {
  SIDECAR_TOKEN: securityEnv.SIDECAR_TOKEN,
  SIDECAR_ASSERTION_SECRET: ledgerEnv.SIDECAR_ASSERTION_SECRET,
  PEER_SIM_TOKEN: securityEnv.PEER_SIM_TOKEN,
});

if (!existsSync(path.join(sidecar, ".secrets", "pki", "ca.pem"))) {
  if (!existsSync(path.join(sidecar, "node_modules"))) {
    console.log("skip   PKI generation: run `npm run install:all` first, then `npm run setup` again");
  } else {
    console.log("generate research PKI (classical ECDSA P-256 certificates)");
    execFileSync("npm", ["--prefix", "pqc-sidecar", "run", "pki"], { cwd: root, stdio: "inherit", shell: true });
  }
} else {
  console.log(`keep   ${rel(path.join(sidecar, ".secrets", "pki"))} (already exists)`);
}

console.log("\nSetup complete. Next: npm run db:up && npm run migrate && npm run seed && npm run register-peers");
