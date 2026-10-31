#!/usr/bin/env node
// End-to-end validation of the running prototype through its real APIs. It does not mock anything:
// it logs in as each role, drives the simulated peers through the sidecar over real TLS, makes real
// ledger postings, switches the TLS profile live and measures time-to-apply, then verifies both audit
// chains. Results are written as machine-readable JSON plus a human report under evidence/e2e/<run>/.
//
// Prerequisites: `npm run db:up`, `migrate`, `seed`, `register-peers`, and the services running:
//   ledger-service :3000, security-service :3200, pqc-sidecar (TLS :8443, admin :8081), peer simulator :3300.
// Features that are not deployed yet (CBOM, HNDL, benchmark ingestion) are reported as SKIPPED, never faked.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = process.env.LEDGER_URL ?? "http://localhost:3000";
const SECURITY = process.env.SECURITY_URL ?? "http://localhost:3200";
const SIDECAR_ADMIN = process.env.SIDECAR_ADMIN_URL ?? "http://127.0.0.1:8081";
const SIMULATOR = process.env.SIMULATOR_URL ?? "http://127.0.0.1:3300";

const credentials = JSON.parse(readFileSync(path.join(root, "ledger-service", ".secrets", "demo-credentials.json"), "utf8"));
const simulatorToken = /^PEER_SIM_TOKEN=(.+)$/m.exec(readFileSync(path.join(root, "pqc-sidecar", ".env"), "utf8"))?.[1];

const results = [];
let section = "";
const startedAt = new Date();

function record(name, status, detail = "", evidence = undefined) {
  results.push({ section, name, status, detail, ...(evidence !== undefined ? { evidence } : {}) });
  const mark = status === "PASS" ? "PASS " : status === "SKIP" ? "SKIP " : "FAIL ";
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ""}`);
}

function check(name, condition, detail = "", evidence = undefined) {
  record(name, condition ? "PASS" : "FAIL", detail, evidence);
  return Boolean(condition);
}

async function http(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function login(email) {
  const r = await http("POST", `${LEDGER}/auth/login`, { body: { email, password: credentials[email] } });
  if (r.status !== 200) throw new Error(`login as ${email} failed with ${r.status}`);
  return r.json.accessToken;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

async function main() {
  // ---------------------------------------------------------------------------------------------
  section = "1. Services";
  const health = {
    ledger: await http("GET", `${LEDGER}/healthz`).catch(() => ({ status: 0 })),
    security: await http("GET", `${SECURITY}/healthz`).catch(() => ({ status: 0 })),
    sidecar: await http("GET", `${SIDECAR_ADMIN}/healthz`).catch(() => ({ status: 0 })),
    simulator: await http("GET", `${SIMULATOR}/healthz`).catch(() => ({ status: 0 })),
  };
  for (const [name, r] of Object.entries(health)) check(`${name} is healthy`, r.status === 200, `HTTP ${r.status}`);
  if (Object.values(health).some((r) => r.status !== 200)) throw new Error("not all services are running; start them first (see the header of this script)");

  const sidecarStatus = (await http("GET", `${SIDECAR_ADMIN}/status`)).json;
  check("the sidecar is ready and has applied a configuration", sidecarStatus.ready && sidecarStatus.appliedConfigVersion > 0, `config v${sidecarStatus.appliedConfigVersion}, profile ${sidecarStatus.activeProfile}`);

  const tokens = {};
  for (const role of ["customer:ayesha@pq-bank.test", "customer:imran@pq-bank.test", "operator:operator@pq-bank.test", "security_admin:secadmin@pq-bank.test", "auditor:auditor@pq-bank.test"]) {
    const [name, email] = role.split(":");
    tokens[name === "customer" ? email.split("@")[0] : name] = await login(email);
  }
  const { ayesha, imran, operator, security_admin: admin, auditor } = tokens;

  // ---------------------------------------------------------------------------------------------
  section = "2. Authentication and role-based access";
  const wrong = await http("POST", `${LEDGER}/auth/login`, { body: { email: "ayesha@pq-bank.test", password: "definitely-wrong-password" } });
  check("a wrong password is rejected with a generic error", wrong.status === 401 && wrong.json.error.code === "INVALID_CREDENTIALS");
  check("a customer cannot read the security console", (await http("GET", `${SECURITY}/v1/overview`, { token: ayesha })).status === 403);
  check("an operator cannot read the security console", (await http("GET", `${SECURITY}/v1/overview`, { token: operator })).status === 403);
  check("an auditor can read the security console", (await http("GET", `${SECURITY}/v1/overview`, { token: auditor })).status === 200);
  check("an auditor cannot change the TLS profile", (await http("POST", `${SECURITY}/v1/crypto/config/active`, { token: auditor, body: { profile: "hybrid-only" } })).status === 403);
  check("a customer cannot read the audit log", (await http("GET", `${LEDGER}/audit/events`, { token: ayesha })).status === 403);
  const ayeshaAccounts = (await http("GET", `${LEDGER}/accounts`, { token: ayesha })).json;
  const imranAccounts = (await http("GET", `${LEDGER}/accounts`, { token: imran })).json;
  check("a customer sees only their own accounts", ayeshaAccounts.length >= 2 && ayeshaAccounts.every((a) => !imranAccounts.some((b) => b.id === a.id)));
  check("a customer cannot read another customer's account (same 404 as nonexistent)", (await http("GET", `${LEDGER}/accounts/${imranAccounts[0].id}`, { token: ayesha })).status === 404);
  const negative = await http("POST", `${LEDGER}/transfers`, {
    token: ayesha,
    headers: { "idempotency-key": `e2e-negative-${Date.now()}` },
    body: { fromAccountId: ayeshaAccounts[0].id, toAccountId: imranAccounts[0].id, amountMinorUnits: "-1000", currency: "BDT", description: "attempt to pull money" },
  });
  check("a negative transfer amount (which would reverse direction) is rejected", negative.status === 400);

  // ---------------------------------------------------------------------------------------------
  section = "3. Experiment B and C scenarios (simulated peers -> sidecar, real TLS 1.3)";
  const simHeaders = { authorization: `Bearer ${simulatorToken}`, "content-type": "application/json" };
  const scenarios = await (await fetch(`${SIMULATOR}/scenarios`, { headers: simHeaders })).json();
  const standalone = scenarios.filter((s) => !s.requires?.length);
  const runScenario = async (id, params) => (await (await fetch(`${SIMULATOR}/scenarios/${id}/run`, { method: "POST", headers: simHeaders, body: params ? JSON.stringify(params) : undefined })).json());
  const scenarioResults = {};
  for (const s of standalone) {
    const r = await runScenario(s.id);
    scenarioResults[s.id] = r;
    check(`scenario ${s.id}: expected ${r.expected}, observed ${r.observed}`, r.passed, `group=${r.detail.selectedGroup ?? "-"} hello=${r.detail.clientHelloBytes ?? "-"}B`, r.detail);
  }
  const hybrid = scenarioResults["hybrid-peer-hybrid-required"]?.detail;
  const classical = scenarioResults["classical-peer-fallback-allowed"]?.detail;
  check("hybrid server key share is 1120 bytes (RFC 10024) and classical is 32", hybrid?.serverKeyShareBytes === 1120 && classical?.serverKeyShareBytes === 32, `${hybrid?.serverKeyShareBytes} / ${classical?.serverKeyShareBytes}`);

  // ---------------------------------------------------------------------------------------------
  section = "4. End-to-end partner payments (peer -> sidecar -> core -> ledger)";
  const target = ayeshaAccounts.find((a) => a.kind === "current");
  const before = BigInt((await http("GET", `${LEDGER}/accounts/${target.id}`, { token: ayesha })).json.balanceMinorUnits);
  const payments = {};
  for (const id of ["partner-payment-hybrid", "partner-payment-classical-fallback"]) {
    const r = await runScenario(id, { toAccountId: target.id, amountMinorUnits: "2500", reference: `e2e ${id}` });
    payments[id] = r;
    check(`${id}: ${r.observed}`, r.passed && r.detail.httpStatus === 201, `tx ${r.detail.transactionId}`);
    const tx = (await http("GET", `${LEDGER}/transactions/${r.detail.transactionId}`, { token: ayesha })).json;
    const ctx = tx?.transaction?.metadata?.context;
    check(`${id}: the ledger transaction records the verified key exchange`, ctx?.channel === "partner" && ctx?.tls?.keyExchange === (id.includes("hybrid") ? "hybrid" : "classical"), JSON.stringify(ctx?.tls));
  }
  const after = BigInt((await http("GET", `${LEDGER}/accounts/${target.id}`, { token: ayesha })).json.balanceMinorUnits);
  check("the customer balance rose by exactly the two payments", after - before === 5000n, `${before} -> ${after}`);
  const forged = await http("POST", `${LEDGER}/partner/v1/payments`, {
    headers: { "idempotency-key": `e2e-forged-${Date.now()}`, "x-sidecar-assertion": "forged.forged" },
    body: { toAccountId: target.id, amountMinorUnits: "1", currency: "BDT", reference: "bypass attempt" },
  });
  check("a direct call to the core with a forged assertion is refused", forged.status === 401 && forged.json.error.code === "PARTNER_ASSERTION_INVALID");
  const operatorAccounts = (await http("GET", `${LEDGER}/accounts?limit=200`, { token: operator })).json;
  const settlement = operatorAccounts.filter((a) => a.kind === "settlement");
  const sumAll = operatorAccounts.reduce((acc, a) => acc + BigInt(a.balanceMinorUnits), 0n);
  check("double entry holds across the whole ledger: all balances sum to zero", sumAll === 0n && settlement.length >= 2, `sum=${sumAll}, ${operatorAccounts.length} accounts`);

  // ---------------------------------------------------------------------------------------------
  section = "5. Experiment E: live TLS profile switch (crypto agility)";
  const waitInSync = async (version, timeoutMs = 20_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const s = (await http("GET", `${SIDECAR_ADMIN}/status`)).json;
      if (s.appliedConfigVersion >= version) return { ms: Date.now() - started, status: s };
      await sleep(250);
    }
    return null;
  };
  const originalProfile = (await http("GET", `${SECURITY}/v1/crypto/config`, { token: admin })).json.activeProfile.name;
  const switchTo = async (profile, note) => {
    if (originalProfile === profile && profile === (await http("GET", `${SECURITY}/v1/crypto/config`, { token: admin })).json.activeProfile.name) return null;
    return http("POST", `${SECURITY}/v1/crypto/config/active`, { token: admin, body: { profile, note } });
  };
  let changed = await switchTo("hybrid-only", "e2e validation: experiment E");
  if (changed?.status === 200) {
    const applied = await waitInSync(changed.json.version);
    check("the sidecar applies the new profile to new connections without a restart", applied !== null, applied ? `applied after ${applied.ms} ms (polling interval bound)` : "timed out");
    const fallbackNow = await runScenario("classical-peer-fallback-allowed");
    check("under hybrid-only a classical-only handshake is refused", fallbackNow.observed === "handshake-failed", `observed ${fallbackNow.observed}`, fallbackNow.detail);
    const hybridNow = await runScenario("hybrid-peer-hybrid-required");
    check("under hybrid-only a hybrid peer still connects", hybridNow.observed === "allowed-hybrid");
    changed = await switchTo("classical-baseline", "e2e validation: control condition");
    const applied2 = await waitInSync(changed.json.version);
    const control = await runScenario("hybrid-peer-hybrid-required");
    check("under the classical baseline even a hybrid-capable peer is forced onto X25519 (hybrid-required policy then rejects it)", applied2 !== null && control.observed === "rejected-violation", `observed ${control.observed}`);
    const restore = await http("POST", `${SECURITY}/v1/crypto/config/active`, { token: admin, body: { profile: originalProfile, note: "e2e validation: restore" } });
    const applied3 = await waitInSync(restore.json.version);
    const restored = await runScenario("hybrid-peer-hybrid-required");
    check(`restoring ${originalProfile} restores hybrid`, applied3 !== null && restored.observed === "allowed-hybrid");
    const history = (await http("GET", `${SECURITY}/v1/crypto/config`, { token: admin })).json.history;
    const timed = history.filter((h) => h.kind === "tls_profile" && h.timeToApplyMs !== null).slice(0, 3);
    check("time-to-apply is recorded per configuration version", timed.length >= 3, timed.map((h) => `${h.timeToApplyMs}ms`).join(", "), timed.map((h) => ({ version: h.version, profile: h.activeProfile, timeToApplyMs: h.timeToApplyMs })));
    const audited = (await http("GET", `${SECURITY}/v1/audit/events?action=config.tls_profile.set&limit=5`, { token: auditor })).json.events;
    check("every profile change is in the configuration audit log with the actor", audited.length >= 3 && audited.every((e) => e.actorRole === "security_admin"));
  } else {
    record("profile switch", "SKIP", `active profile is already ${originalProfile}; could not switch`);
  }

  // ---------------------------------------------------------------------------------------------
  section = "6. Telemetry and alerts";
  await sleep(2500);
  const overview = (await http("GET", `${SECURITY}/v1/overview`, { token: auditor })).json;
  const byDecision = overview.telemetry.byDecision;
  for (const d of ["allowed-hybrid", "allowed-fallback", "rejected-violation", "rejected-unknown-peer", "handshake-failed"]) {
    check(`telemetry contains '${d}' events`, (byDecision[d] ?? 0) > 0, `${byDecision[d] ?? 0} in 24h`);
  }
  check("the sidecar reports in sync and not stale", overview.sidecars[0]?.inSync === true && overview.sidecars[0]?.stale === false);
  const alerts = (await http("GET", `${SECURITY}/v1/telemetry/alerts?limit=5`, { token: admin })).json;
  if (alerts.length > 0) {
    const ack = await http("POST", `${SECURITY}/v1/telemetry/alerts/${alerts[0].id}/acknowledge`, { token: admin, body: { note: "e2e validation" } });
    check("a security admin can acknowledge an alert", ack.status === 200 && ack.json.acknowledgedAt);
  } else {
    record("alert acknowledgement", "SKIP", "no open alerts");
  }

  // ---------------------------------------------------------------------------------------------
  section = "7. Audit integrity";
  const ledgerChain = (await http("GET", `${LEDGER}/audit/verify`, { token: auditor })).json;
  const securityChain = (await http("GET", `${SECURITY}/v1/audit/verify`, { token: auditor })).json;
  check("the banking audit chain verifies", ledgerChain.valid === true, `${ledgerChain.eventsChecked} events, head ${ledgerChain.headHash?.slice(0, 12)}`, { headHash: ledgerChain.headHash });
  check("the security configuration audit chain verifies", securityChain.valid === true, `${securityChain.eventsChecked} events, head ${securityChain.headHash?.slice(0, 12)}`, { headHash: securityChain.headHash });

  // ---------------------------------------------------------------------------------------------
  section = "8. Research features (checked only when deployed)";
  const cbomProbe = await http("GET", `${SECURITY}/v1/cbom`, { token: auditor });
  if (cbomProbe.status === 200) {
    const gen = await http("POST", `${SECURITY}/v1/cbom/generate`, { token: admin, body: {} });
    check("a CycloneDX CBOM is generated and validates against the schema", gen.status === 201 && gen.json.validation?.valid === true, `id ${gen.json?.id}`, gen.json?.validation);
    if (gen.status === 201) {
      const cmp = await http("POST", `${SECURITY}/v1/cbom/${gen.json.id}/compare`, { token: admin, body: {} });
      check("the CBOM is compared with the manually prepared ground truth", cmp.status === 200 || cmp.status === 201, cmp.json ? `completeness ${cmp.json.metrics?.completeness}, precision ${cmp.json.metrics?.precision}` : "", cmp.json?.metrics);
    }
  } else {
    record("CBOM generation and validation", "SKIP", `GET /v1/cbom returned ${cbomProbe.status} (not deployed in the running security-service)`);
  }
  const hndlProbe = await http("GET", `${SECURITY}/v1/hndl/runs`, { token: auditor });
  if (hndlProbe.status === 200) {
    const run = await http("POST", `${SECURITY}/v1/hndl/run`, { token: admin, body: { message: "e2e toy secret", quantumAssumption: "x25519-broken" } });
    check("the HNDL simulator labels itself a simulation", run.status === 201 && run.json.label === "SIMULATION", run.json?.disclaimer ?? `HTTP ${run.status}`);
    check(
      "under an assumed X25519 break the classical capture opens and the hybrid capture stays closed",
      run.json?.sessions?.classical?.recovered === true && run.json?.sessions?.hybrid?.recovered === false,
      run.json?.sessions?.hybrid?.reason ?? "",
    );
    const mosca = await http("POST", `${SECURITY}/v1/hndl/mosca`, { token: auditor, body: { shelfLifeYears: 10, migrationYears: 5, yearsToQuantum: 12 } });
    check("the Mosca calculator reports 3 exposure years for X=10, Y=5, Z=12", mosca.status === 200 && mosca.json.atRisk === true && mosca.json.exposureYears === 3);
  } else {
    record("HNDL simulator", "SKIP", `GET /v1/hndl/runs returned ${hndlProbe.status} (not deployed)`);
  }

  // ---------------------------------------------------------------------------------------------
  const failed = results.filter((r) => r.status === "FAIL").length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, "evidence", "e2e", runId);
  mkdirSync(dir, { recursive: true });
  const meta = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    commit: git(["rev-parse", "HEAD"]),
    workingTreeDirty: (git(["status", "--porcelain"]) ?? "").length > 0,
    node: process.versions.node,
    openssl: process.versions.openssl,
    host: `${os.platform()} ${os.release()} ${os.cpus()[0]?.model ?? ""}`.trim(),
    sidecar: { instanceId: sidecarStatus.instanceId, startedAt: sidecarStatus.startedAt },
    totals: { passed, failed, skipped },
  };
  const json = JSON.stringify({ meta, results }, null, 2);
  writeFileSync(path.join(dir, "results.json"), json);
  const bySection = [...new Set(results.map((r) => r.section))];
  const lines = [
    `# End-to-end validation ${runId}`,
    "",
    `Commit ${meta.commit?.slice(0, 12) ?? "unknown"}${meta.workingTreeDirty ? " (working tree had uncommitted changes)" : ""} · Node ${meta.node} · OpenSSL ${meta.openssl} · ${meta.host}`,
    `**${passed} passed, ${failed} failed, ${skipped} skipped.** Single host, loopback, simulated peers; not a production deployment.`,
    "",
    ...bySection.flatMap((s) => [
      `## ${s}`,
      "",
      "| result | check | detail |",
      "|---|---|---|",
      ...results.filter((r) => r.section === s).map((r) => `| ${r.status} | ${r.name.replace(/\|/g, "\\|")} | ${String(r.detail).replace(/\|/g, "\\|")} |`),
      "",
    ]),
  ];
  writeFileSync(path.join(dir, "report.md"), lines.join("\n"));
  writeFileSync(path.join(dir, "results.sha256"), `${createHash("sha256").update(json).digest("hex")}  results.json\n`);
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped. Evidence written to ${path.relative(root, dir)}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nE2E aborted: ${err.message}`);
  process.exitCode = 2;
});
