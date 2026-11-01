# Implementation Roadmap

Dependency-aware, grouped by priority. Complexity S/M/L/XL. "Risk" = risk of modifying existing working behavior. No time estimates. Preserve the hexagonal boundaries and the TLS design; these tasks add production scaffolding and close specific defects, not a rewrite. Do **not** replace the reference core.

## P0 — Critical blockers (before any real-banking consideration)

### T-P0-1 — Make the partner assertion replay-proof
- NFR: API-005, SEC-002 · Evidence: `pqc-sidecar/src/sidecar/assertion.ts:25-62`, `ledger-service/src/partner/assertion.ts`
- Missing: `jti`/nonce; single-use enforcement.
- Change: add `jti` to the signed body; core keeps a short-lived single-use cache keyed by `jti` within the 30 s window; reject reuse.
- Depends: none · Tests: replay-of-same-jti rejected; distinct-jti accepted; window honored · Accept: a captured assertion cannot be replayed · Complexity: S · Risk: low (versioned bump, both sides unit-tested today).

### T-P0-2 — Transactional outbox for ledger audit
- NFR: FIN-010, OBS-003 · Evidence: `ledger-service/src/app/audit-service.ts:6-14`
- Missing: atomicity between posting and its audit event.
- Change: write an outbox row in the posting transaction; a relay appends to the audit chain and marks sent; idempotent.
- Depends: none · Tests: crash-after-commit still yields exactly one audit event; no posting without an event · Accept: no unaudited committed posting · Complexity: M · Risk: medium (touches posting path; covered by integration tests).

### T-P0-3 — Verify Supabase `aud` + gate auto-provisioning
- NFR: IAM-002, DATA-012 · Evidence: `ledger-service/src/adapters/supabase/verifier.ts:37-40`, `identity-service.ts:263-282`
- Change: enforce expected `aud`; require an explicit allow/invite before provisioning a customer.
- Depends: none · Tests: token with wrong `aud` rejected; unexpected project user not auto-provisioned · Accept: only intended audience + invited users admitted · Complexity: S · Risk: low.

### T-P0-4 — CI pipeline + supply-chain scanning + dependency SBOM
- NFR: OPS-002/003/010, SEC-016 · Evidence: no `.github/`
- Change: CI runs `npm run test:all`, type-check, web lint, `claim-audit`, `npm audit`/Dependabot/Trivy, and generates a CycloneDX **dependency** SBOM.
- Depends: none · Tests: pipeline green on clean tree; fails on introduced vuln/claim · Accept: every PR gated · Complexity: M · Risk: low (additive).

### T-P0-5 — Secrets management + KMS/HSM + key rotation
- NFR: SEC-007/008/009/010 · Evidence: `ledger-service/src/compose.ts:28-37`, `.env`
- Change: load signing/HMAC keys from a secrets manager/KMS; support multiple `kid` + rotation; enable at-rest encryption (encrypted volumes + sensitive-column encryption).
- Depends: none (enables later HA) · Tests: rotation keeps JWKS valid; old `kid` still verifies until drained · Accept: no plaintext long-lived secret on disk; rotation works · Complexity: L · Risk: medium (token issuance + JWKS).

### T-P0-6 — Transaction reversals / compensating entries
- NFR: FIN-006/008 · Evidence: `ledger-service/src/domain/ledger.ts:57` (`reversed` unused)
- Change: a reversal operation that posts compensating balanced entries and marks the original `reversed`; authorized role; audited; never mutates history.
- Depends: T-P0-2 (audit) · Tests: reversal balances to zero; double-reversal blocked; audit trail present · Accept: erroneous postings correctable without history mutation · Complexity: M · Risk: medium.

### T-P0-7 — Reconciliation / balance-integrity sweep
- NFR: FIN-012 · Evidence: incremental `accounts.balance_minor_units`, no re-derivation
- Change: a job re-derives balances from `postings` and flags drift; partner-settlement reconciliation report.
- Depends: none · Tests: injected drift detected · Accept: drift detectable + alerted · Complexity: M · Risk: low (read-only sweep).

### T-P0-8 — HA + backups + DR evidence
- NFR: REL-002/007/008/009/010/011 · Evidence: single host/Postgres
- Change: HA Postgres (primary+replica, PITR backups), redundant service instances, documented + exercised DR (RPO/RTO).
- Depends: T-P0-5, containerization (P1) · Tests: restore drill; failover drill · Accept: tested DR with RPO/RTO met · Complexity: XL · Risk: medium (ops).

## P1 — Production hardening

### T-P1-1 — Containerize all services + IaC + CD with rollback
NFR OPS-007/011/014, ARCH-005. Dockerfiles for 4 apps; compose/Helm/Terraform; CD with rollback. Depends T-P0-4. Complexity L. Risk low (no code change).

### T-P1-2 — Observability stack
NFR OBS-005/006/008, REL-006. Prometheus metrics + `/metrics`, OpenTelemetry tracing, alerting pipeline; add `/readyz` to ledger & sidecar, `/livez` everywhere. Complexity M. Risk low.

### T-P1-3 — Distributed state for limits/sessions
NFR SEC-011, PERF-009. Shared store (Redis/DB) for rate limits + registry cache; enables horizontal scale without weakening authz/consistency. Depends T-P1-1. Complexity M. Risk medium (limiter wiring).

### T-P1-4 — Internal transport hardening
NFR SEC-001/002. mTLS (or service mesh) for sidecar→core and service→service; TLS to Postgres; terminate TLS for web+APIs at the edge. Complexity M. Risk medium.

### T-P1-5 — Identity hardening
NFR IAM-001/003/008/009. MFA (WebAuthn) for staff; token introspection/short TTL in security-service; step-up for sensitive ops; access-review process. Complexity M. Risk medium.

### T-P1-6 — Audit-tip external anchor
NFR OBS-003. Periodic head-hash to a WORM/notary store; schedule a verify job. Depends T-P0-2. Complexity S. Risk low.

### T-P1-7 — Cert lifecycle + revocation + drift
NFR PQC-012, ADV-007/008. OCSP/CRL (or short-lived certs); expiry monitoring/renewal; config drift detection; migration-coverage metric (ADV-004). Complexity M. Risk medium.

### T-P1-8 — API/perf/resilience tests + SLOs
NFR PERF-001/002/003/010, REL-005, ADV-001. OpenAPI specs; load/stress/spike/soak; circuit breakers; SLOs + error budgets. Complexity L. Risk low.

### T-P1-9 — Governance docs
NFR GOV-001/003/005/006/009, DATA-001/006/009. Risk register, IR plan, provider (Supabase) assessment, BCP, data classification/retention, jurisdiction mapping. Complexity M. Risk none (docs).

### T-P1-10 — Localization
NFR UX-007. i18n framework + Bengali strings for customer-facing UI. Complexity M. Risk low.

### T-P1-11 — Accessibility conformance
NFR UX-001. axe/jest-axe in CI; `aria-live` for async; manual WCAG 2.2 AA audit; mobile navigation (UX-005). Complexity M. Risk low.

## P2 — Advanced

- T-P2-1 Multi-region (ADV-009) — if availability/geography require. XL.
- T-P2-2 Explainable anomaly detection for negotiation/ops (ADV-010) — keep human-reviewable. L.
- T-P2-3 Cost attribution (ADV-005). M.
- T-P2-4 Second TLS provider (BCJSSE) + interop matrix (PQC-015, MIG-013). L.

## R — Research validation

### T-R-1 — Independent CBOM ground truth (**blocks H4 publication**)
NFR RES-010/CBOM-005. A human (not the generator's author) prepares/confirms the scoped ground truth; recompute completeness/precision/recall. Complexity M. Risk none (research artifact).

### T-R-2 — Session-resumption benchmark
NFR RES-007/PERF-007. Add a resumed-handshake arm; report separately. Complexity S.

### T-R-3 — Validity-threats section
NFR RES-018. Consolidate internal/external/construct/conclusion validity threats. Complexity S (writing).

### T-R-4 — Cross-machine + full-preset benchmarks
Beyond single-laptop loopback; `--preset full` (30×1000). Complexity M.

## Suggested stage mapping (master-prompt §9)
Stage 2 fixes → T-P0-1/2/3/5; Stage 3 (crypto/fallback/policy already strong) → T-P1-7, T-P2-4; Stage 4 (integration/txn/audit) → T-P0-6/7, T-P1-6; Stage 5 (reliability) → T-P0-8, T-P1-1/2/3/4/8; Stage 6 (CBOM/provider lifecycle) → T-R-1, T-P1-7; Stage 7 (science) → T-R-2/3/4; Stage 8 (assurance) → T-P1-9, external pentest, regulator engagement. T-P0-4 (CI) underpins all stages and should land first.
