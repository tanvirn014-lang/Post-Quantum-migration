#!/usr/bin/env node
// Registers the simulated peers (fingerprints only - never keys) in security-service, as a
// security administrator, through the public API. Idempotent: peers that exist are left alone.
// Credentials come from the git-ignored demo-credentials file written by `npm run seed`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerUrl = process.env.LEDGER_URL ?? "http://localhost:3000";
const securityUrl = process.env.SECURITY_URL ?? "http://localhost:3200";
const email = "secadmin@pq-bank.test";

const credentials = JSON.parse(readFileSync(path.join(root, "ledger-service", ".secrets", "demo-credentials.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(root, "pqc-sidecar", ".secrets", "pki", "peers.json"), "utf8"));

const login = await fetch(`${ledgerUrl}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password: credentials[email] }),
});
if (!login.ok) throw new Error(`login as ${email} failed (${login.status}); is ledger-service running and seeded?`);
const { accessToken } = await login.json();
const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };

const existing = await (await fetch(`${securityUrl}/v1/peers`, { headers })).json();
for (const peer of manifest.filter((p) => p.registered)) {
  const byFingerprint = existing.find((e) => e.certSha256 === peer.certSha256);
  if (byFingerprint) {
    console.log(`keep   ${peer.name} (already registered, ${byFingerprint.profile})`);
    continue;
  }
  const res = await fetch(`${securityUrl}/v1/peers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: peer.name, description: peer.description, certSha256: peer.certSha256, profile: peer.profile }),
  });
  console.log(res.ok ? `create ${peer.name} (${peer.profile})` : `FAILED ${peer.name}: ${res.status} ${await res.text()}`);
}
