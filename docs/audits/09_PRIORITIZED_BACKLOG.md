# Prioritized Backlog

Developer/AI-agent-ready tickets, highest priority first. Each maps to `06_IMPLEMENTATION_ROADMAP.md`. Follow TDD; do not weaken any existing control to make a test pass.

---

### BKLG-01 — Replay-proof partner assertion
**Problem:** The sidecar→core HMAC assertion has no `jti`/nonce; a captured assertion is replayable to the same method+path for 30 s, and the shared secret lets either side mint one.
**Scope:** Add `jti` to the signed body; core single-use cache within the freshness window. **NFR:** API-005, SEC-002. **Depends:** none.
**Files:** `pqc-sidecar/src/sidecar/assertion.ts`, `ledger-service/src/partner/assertion.ts`, `ledger-service/src/http/routes/partner.ts`.
**Approach:** bump `v`→2; include random `jti`; core rejects a seen `jti` (in-memory TTL cache now, shared store later).
**Security:** constant-time compare retained; cache keyed only by `jti`; no secret logged.
**Testing:** replay-of-jti rejected; distinct-jti accepted; stale window rejected; old `v:1` handling decided (reject).
**DoD:** new tests pass; existing partner tests green; CLAIM_LEDGER/TRACEABILITY updated.

### BKLG-02 — Transactional outbox for ledger audit
**Problem:** Postings commit in a separate transaction from their audit event (at-least-once); a failure leaves an unaudited committed posting.
**Scope:** Outbox row in the posting tx + relay to the audit chain. **NFR:** FIN-010, OBS-003. **Depends:** none.
**Files:** `ledger-service/migrations/*` (new outbox table), `src/app/audit-service.ts`, `src/adapters/postgres/*`, posting routes.
**Approach:** write `audit_outbox` inside `postTransaction`; a relay appends to `audit_events` idempotently and marks sent.
**Security:** chain integrity preserved; outbox cannot alter chain ordering.
**Testing:** crash-after-commit → exactly one event; no posting without an event; chain still verifies.
**DoD:** integration tests pass; audit chain verify green.

### BKLG-03 — Verify Supabase `aud` + gate provisioning
**Problem:** Verifier checks `iss`+alg but not `aud`; any project token auto-creates a customer.
**Scope:** enforce `aud`; require explicit allow/invite before provisioning. **NFR:** IAM-002, DATA-012. **Depends:** none.
**Files:** `ledger-service/src/adapters/supabase/verifier.ts`, `src/app/identity-service.ts`, `src/config.ts`.
**Security:** reject wrong audience; audit provisioning decisions.
**Testing:** wrong-`aud` rejected; uninvited user not provisioned; invited flow unchanged.
**DoD:** tests pass; `SUPABASE_AUDIENCE` documented in `.env.example`.

### BKLG-04 — CI pipeline + scanning + dependency SBOM
**Problem:** No CI; no dependency/container scanning; no dependency SBOM.
**Scope:** add `.github/workflows` (or chosen CI) running `test:all`, type-check, web lint, `claim-audit`, `npm audit`/Dependabot/Trivy, CycloneDX dep SBOM. **NFR:** OPS-002/003/010, SEC-016.
**Files:** new `.github/workflows/*.yml`, scripts.
**Security:** fail on high-severity vulns and restricted-claim hits; cache safely.
**Testing:** pipeline green on clean tree; fails on injected vuln/claim.
**DoD:** every push/PR gated; SBOM artifact published.

### BKLG-05 — Secrets manager + KMS/HSM + rotation + at-rest encryption
**Problem:** Signing key is a disk PEM; HMAC secret plaintext; no rotation; no at-rest encryption.
**Scope:** load keys from secrets manager/KMS; multi-`kid` rotation; encrypted volumes + sensitive-column encryption. **NFR:** SEC-007/008/009/010. **Depends:** none (enables BKLG-13).
**Files:** `ledger-service/src/compose.ts`, token/JWKS modules, deploy config.
**Security:** no long-lived plaintext secret on disk; JWKS publishes active+draining keys.
**Testing:** rotation keeps JWKS valid; old `kid` verifies until drained.
**DoD:** rotation works; secrets sourced from manager.

### BKLG-06 — Transaction reversals / compensating entries
**Problem:** `reversed` status exists but no reversal mechanism.
**Scope:** authorized reversal posting compensating balanced entries; mark original `reversed`; audited. **NFR:** FIN-006/008. **Depends:** BKLG-02.
**Files:** `ledger-service/src/domain/ledger.ts`, app service, partner/transactions routes, migration.
**Security:** role-gated; never mutate history; idempotent.
**Testing:** reversal sums to zero; double-reversal blocked; audit present.
**DoD:** tests pass; runbook updated.

### BKLG-07 — Reconciliation / balance-integrity sweep
**Problem:** Incremental balances never re-derived; drift undetected; no settlement reconciliation.
**Scope:** job re-deriving balances from `postings`, flag drift; partner-settlement report. **NFR:** FIN-012. **Depends:** none.
**Files:** `ledger-service/scripts/*` or a service job.
**Testing:** injected drift detected + reported.
**DoD:** read-only sweep + alert path.

### BKLG-08 — Observability stack
**Problem:** No metrics/tracing/alerting; `/readyz` only on security-service; no `/livez`.
**Scope:** Prometheus `/metrics`, OpenTelemetry tracing, alerting; add `/readyz` to ledger+sidecar, `/livez` all. **NFR:** OBS-005/006/008, REL-006.
**Files:** each service `src/http/server.ts`/`main.ts`.
**Testing:** probes return correct states; metrics scrape; trace spans across sidecar→core.
**DoD:** dashboards + alerts defined.

### BKLG-09 — Internal transport hardening
**Problem:** sidecar→core and service↔service plain HTTP; Postgres no TLS.
**Scope:** mTLS/service mesh internally; TLS to Postgres; edge TLS termination for web+APIs. **NFR:** SEC-001/002. **Depends:** BKLG-05.
**Testing:** non-TLS internal connection refused; cert rotation.
**DoD:** all sensitive hops encrypted + authenticated.

### BKLG-10 — Identity hardening (MFA, introspection, step-up)
**Problem:** No MFA; security-service honors tokens until expiry; no step-up; no access review.
**Scope:** WebAuthn MFA for staff; token introspection/short TTL; step-up for sensitive ops. **NFR:** IAM-001/003/008/009. **Depends:** BKLG-05.
**Testing:** disabled user blocked pre-expiry; MFA required for admin; step-up enforced.
**DoD:** tests pass; recovery flow documented.

### BKLG-11 — HA + backups + DR
**Problem:** Single host/Postgres; no backups/failover/DR.
**Scope:** HA Postgres (replica + PITR), redundant instances, exercised DR with RPO/RTO. **NFR:** REL-002/007/008/009/010/011. **Depends:** BKLG-05, BKLG-12.
**Testing:** restore + failover drills.
**DoD:** documented + tested DR.

### BKLG-12 — Containerize + IaC + CD
**Problem:** Only Postgres containerized; bare Node processes; no IaC/CD.
**Scope:** Dockerfiles for 4 apps; compose/Helm/Terraform; CD with rollback. **NFR:** OPS-007/011/014, ARCH-005. **Depends:** BKLG-04.
**DoD:** reproducible deploy + rollback drill.

### BKLG-13 — Distributed limiter/session store
**Problem:** In-memory limits break under horizontal scale.
**Scope:** shared store (Redis/DB) for rate limits, registry cache, sessions. **NFR:** SEC-011, PERF-009. **Depends:** BKLG-12.
**Testing:** limits hold across instances.

### BKLG-14 — Cert lifecycle, revocation, drift, coverage metric
**Problem:** No revocation, single CA, no expiry monitoring, no drift/coverage.
**Scope:** OCSP/CRL (or short-lived certs); expiry monitor + renewal; drift detection; migration-coverage metric. **NFR:** PQC-012, ADV-004/007/008.
**Testing:** revoked cert rejected; expiry alert; drift flagged.

### BKLG-15 — Independent CBOM ground truth (research)
**Problem:** Ground truth prepared by the generator's own AI author; not independent.
**Scope:** a human (not the generator author) prepares/confirms scoped ground truth; recompute metrics. **NFR:** RES-010, CBOM-005.
**Files:** `security-service/ground-truth/cbom-ground-truth.json` (versioned), compare output.
**DoD:** independent provenance recorded; H4 numbers re-reported.

### BKLG-16 — API/perf/resilience tests + SLOs
**Scope:** OpenAPI specs; load/stress/spike/soak; circuit breakers; SLOs + error budgets; resumption benchmark. **NFR:** PERF-001/002/003/007/010, REL-005, ADV-001. **Depends:** BKLG-08.

### BKLG-17 — Governance documentation set
**Scope:** risk register, incident-response plan, Supabase provider assessment, BCP, data classification/retention, jurisdiction mapping (incl. Bangladesh Bank). **NFR:** GOV-001/003/005/006/009, DATA-001/006/009.
**DoD:** documents reviewed + owners assigned.

### BKLG-18 — Localization (Bengali/English)
**Scope:** i18n framework + Bengali strings for customer UI; locale number/date. **NFR:** UX-007. **Depends:** none.

### BKLG-19 — Accessibility conformance + mobile nav
**Scope:** axe/jest-axe in CI; `aria-live` for async updates; WCAG 2.2 AA manual audit; mobile navigation/drawer. **NFR:** UX-001/005. **Depends:** BKLG-04.

### BKLG-20 — Fix documentation drift
**Problem:** `moneypurse-web/README.md` still says auth is stubbed/no-login and references an untracked `lib/demo-accounts.ts`; no root README; two services lack READMEs.
**Scope:** update web README to the shipped auth; add root + per-service READMEs; remove stale references. **NFR:** ARCH-010. **Depends:** none. **Complexity:** S.
**DoD:** docs match code; links valid.

---
**Suggested first sprint (dependency-safe, high value):** BKLG-01, BKLG-03, BKLG-20 (all S, no deps), then BKLG-04, then BKLG-02. BKLG-15 can run in parallel as a research track.
