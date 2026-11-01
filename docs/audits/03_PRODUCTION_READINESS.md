# Production Readiness

**Verdict: PRE-PRODUCTION. Not a "production technically candidate"** — several applicable P0 technical gates are unmet. This is consistent with the project's declared research scope (`docs/PROJECT_STATUS.md:9-10`); it is a statement of fact, not a criticism of the research.

The audit separates five assurance layers as the master prompt requires.

## A. Technically implemented controls (code exists)
- Hybrid TLS 1.3 + classical fallback + per-peer policy + wire-verified group (`pqc-sidecar`).
- RBAC (4 roles, SoD), ownership checks, scrypt, EdDSA JWT+JWKS, refresh rotation with reuse detection, login lockout, forced password change (`ledger-service/src/identity`, `src/app/identity-service.ts`).
- Double-entry ledger with DB balance trigger, per-user/per-peer idempotency, `FOR UPDATE` concurrency, bigint money (`ledger-service`).
- Two hash-chained append-only audit logs with verify endpoints + DB immutability triggers.
- Versioned, transactional, audited crypto configuration; provider/profile registries with validation.
- CycloneDX 1.7 CBOM, HNDL simulator, benchmark harness with validity gate.
- Input validation (zod) everywhere; CORS allow-list; Helmet; rate limiting; log redaction; CSRF origin guard.

## B. Technically verified controls (tests/evidence this audit)
- `npm run test:all` → **617/617** (ledger 150, security 144 real Postgres, sidecar 113 real TLS, web 210).
- Recorded live e2e **50/50** (`evidence/e2e/2026-11-01T00-24-56-403Z/`): auth/RBAC, all 7 TLS scenarios, partner payments with double-entry sum=0, live profile switch, telemetry/alerts, both audit chains verify, CBOM validates, HNDL.
- Benchmark valid run with CIs; `claim-audit` 0 un-negated.
> Not re-run live this audit (relied on recorded, checksummed evidence): the full 5-service e2e stack (only ledger+web were up); SHA-256 of evidence not recomputed. See "Audit limitations."

## C. Operationally demonstrated controls (running in a real operating environment)
**None at production grade.** Everything is single-host loopback. No deployment, no HA, no backups/DR, no monitoring in operation, no incident handling exercised.

## D. Compliance evidence
**None claimed and none present** (correctly). The system explicitly disclaims banking authorization, PCI validation and ISO certification (`GOV-012`, `scripts/claim-audit.mjs`). See `08_STANDARDS_COMPLIANCE_MAPPING.md`.

## E. External banking authorization / certification
Out of scope and unavailable from this repository; requires a real financial institution, regulator engagement and independent assessors (BLOCKED for verification, by definition).

---

## Dimension-by-dimension

### Security assurance — PARTIAL
Strong appsec primitives (validation, RBAC, CSRF, rate limits, log hygiene). Missing: at-rest encryption (SEC-007), KMS/HSM (SEC-009), MFA (IAM-001), key rotation (SEC-008), independent assessment/pentest (SEC-015/016), full threat model (SEC-014 — authored in `05`). Specific defects: replayable assertion (API-005), Supabase `aud` unverified (IAM-002), unauthenticated admin (SEC-012).

### Legacy integration maturity — PARTIAL
Bounded sidecar boundary, unmodified core, per-peer phased migration, signed assertions — all VERIFIED at prototype scope. Missing: enforcement/monitoring of bypass paths (MIG-004), cross-stack interop matrix (MIG-013), rollback procedures (MIG-011), durable telemetry (MIG-016). Only one TLS stack (Node/OpenSSL).

### Transaction safety — PARTIAL (reference core)
Double-entry, atomicity, idempotency, concurrency, exact money: VERIFIED. **Missing/critical:** reversals/compensating entries not implemented (FIN-006/008 — only `posted`/unused `reversed`); no reconciliation/balance re-derivation (FIN-012); at-least-once audit for postings (FIN-010); no settlement lifecycle (FIN-009); single-node durability only (FIN-005).

### Identity & access — PARTIAL
RBAC/SoD, rotation+reuse detection, ownership, lockout: VERIFIED. Missing: MFA, token introspection/short-TTL (security-service honors tokens to expiry), Supabase `aud` check + provisioning gate, step-up auth, access reviews.

### Data privacy — PARTIAL
Isolation (ownership, separate DBs), log masking, no real data in test: VERIFIED. Missing: classification (DATA-001), retention/destruction (DATA-006), at-rest encryption (SEC-007), cross-border assessment for Supabase (DATA-009/012), DSAR exports (DATA-008).

### Observability — PARTIAL
Structured logs (pino) + domain telemetry + audit chains + correlation ids: present. Missing: metrics/`/metrics` (OBS-005), distributed tracing (OBS-006), alerting pipeline (OBS-008), `/readyz` on ledger & sidecar and `/livez` anywhere (REL-006), synthetic monitoring (OBS-010).

### Availability & recovery — NOT IMPLEMENTED (mostly)
No SLOs, SPOFs everywhere (single host/Postgres/in-memory state), no failover, no backups, no RPO/RTO, no DR test, no multi-AZ, no chaos (REL-001..014). This is the weakest production dimension.

### Performance — PARTIAL (research only)
Handshake benchmarking is excellent and isolated (PERF-004..006). Missing: API latency SLOs, load/stress/spike/soak, capacity planning, resumption benchmark, horizontal-scale correctness (in-memory limits break).

### Compliance dependencies — NOT IMPLEMENTED
No jurisdiction mapping, risk register, incident response, provider assessment, BCP, retention (GOV-001/003/005/006/007/009).

### Operational readiness — NOT IMPLEMENTED
**No CI/CD, no app containers/IaC, no scanning, no SBOM, no deploy/rollback, no release gates, no secrets manager, no runbooks beyond the demo** (OPS-002/003/005/007/010/011/013/014).

### Independent-verification dependencies
External pentest, independent CBOM ground truth, regulator engagement, real-core integration test, cross-machine benchmarks — all required and all outside this repository.

---

## Release-blocking conditions (master-prompt §8) — status
| # | Blocker | Status |
|---|---|---|
| 1 | No verified hybrid handshake | **Absent** (verified present, LIVE) |
| 2 | Silent fallback for hybrid-required peer | **Absent** (rejected; verified) |
| 3 | Unauthenticated/misidentified peer | **Absent** (cert-fingerprint identity, deny-by-default) |
| 4 | Publicly exposed internal services | **Suspected (deployment-dependent)** — admin unauthenticated, loopback-only now |
| 5 | Secrets/keys leaked in code/logs | **Absent from git** (clean); live secret sits in working-tree `.env` (untracked) |
| 6 | Uncontrolled admin access | **Present (prototype)** — sidecar admin has no auth; no MFA for staff |
| 7 | Unencrypted sensitive prod paths w/o compensating design | **Present (prototype)** — internal hops plain HTTP; documented, not compensated |
| 8 | Unauthorized core transactions | **Absent** (assertion-gated, credit-only, RBAC) |
| 9 | Duplicate financial transactions from retries | **Absent** (idempotency verified) |
| 10 | Inconsistent authoritative ledger state | **Absent** (sum=0 verified); no reconciliation to detect drift though |
| 11 | Missing critical transaction audit trails | **Suspected** — at-least-once gap can drop a posting's audit event |
| 12 | Unrecoverable committed financial records | **Suspected** — no backups; single node |
| 13 | Missing DR evidence | **Present** — none |
| 14 | Unresolved critical vulns | **Unknown** — no scanning; Stage 1 defects fixed |
| 15 | Unbounded availability/failure risk on txn paths | **Present** — SPOFs, no failover |
| 16 | Unsupported compliance claims | **Absent** (explicitly disclaimed) |
| 17 | Can't trace deployed crypto boundary | **Absent** — boundary explicit and labelled |
| 18 | CBOM/dashboard claims contradicted by sources | **Absent** — status-registry test enforces evidence existence; ground-truth independence is a research caveat, not a contradiction |
| 19 | Missing prod secrets management | **Present** — no secrets manager/KMS |
| 20 | Unsupported assumptions about external bank integration | **Absent for the reference core**; a real-core integration is untested (outside boundary) |

## Audit limitations
Read-only; no code modified. Live e2e not re-run against the full 5-service stack (only ledger+web were running); recorded evidence used instead. Evidence checksums not recomputed. `.secrets/` private-key contents not inspected (git-ignored, untracked). `pqc-sidecar`↔`ledger` assertion byte-compatibility is unit-asserted on both sides but not re-exercised across processes this audit. Production/compliance/regulatory items are verifiable only with external infrastructure and authorization.
