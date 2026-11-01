# Complete NFR Audit Matrix

**System:** Hybrid Post-Quantum Banking Migration Platform (`pq-banking-prototype`)
**Audit date:** 2026-11-02 · **Auditor:** independent technical review (read-only)
**Commit basis:** branch `design/spatial-fintech` (HEAD `ea728c1`); evidence commit `f77181cd` (e2e), `522678c5` (benchmark)
**Verification performed this audit:** `npm run test:all` → ledger 150 / security 144 / sidecar 113 / web 210 = **617 passed, 0 failed** (Node 26.4.0, OpenSSL 3.5.7, real PostgreSQL on :5432, real TLS 1.3 handshakes). `node scripts/claim-audit.mjs` → 250 files, 7 restricted phrases, **0 un-negated**. Recorded evidence read: `evidence/e2e/2026-11-01T00-24-56-403Z/` (50/50), `evidence/bench/2026-10-31T20-49-52-048Z-standard/`.

> This is a **research prototype that explicitly disclaims production readiness, regulatory compliance, certification and complete quantum resistance** (`docs/PROJECT_STATUS.md:9-10`, `docs/CLAIM_LEDGER.md`). The matrix below grades each requirement against what the code actually does, not against that disclaimer. A large number of production P0/P1 requirements are therefore NOT IMPLEMENTED / BLOCKED / NOT APPLICABLE **by design and by the system's own declared boundary** — that is a scope statement, not a hidden defect. The research (R) requirements and the prototype-level crypto/financial P0s are, by contrast, largely VERIFIED.

## Legend

**Status:** `VERIFIED` (implemented + relevant successful verification evidence) · `PARTIAL` (implemented, acceptance criteria incomplete) · `NOT IMPL` (functionality/control absent) · `UNVERIFIED` (may exist, insufficient verification evidence) · `BLOCKED` (depends on unresolved tech/architecture/access/external dependency) · `N/A` (not required for the documented boundary, rationale given).

**Type:** `LIVE` · `SIM` (simulated/educational) · `CONFIG` (configuration only) · `PLANNED` · `UNK`.

**Applicability:** `MIG` (migration platform) · `BANK` (reference/underlying core) · `SHARED` · `RES` (research) · `COND` (conditional on an activity/market/deployment being in scope).

Evidence paths are repo-relative. `§N` = section N of `docs/PROJECT_STATUS.md` or the named e2e/bench report.

---

## A. Legacy Banking Interoperability

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| MIG-001 | P0 | MIG | VERIFIED (LIVE) | Sidecar fronts an unmodified core; `pqc-sidecar/src/sidecar/server.ts` forwarding allow-list `^/partner/v1`; `ledger-service/src/http/routes/partner.ts` | Reference core, not a real bank core (C-11) | Keep boundary; validate against a real core adapter |
| MIG-002 | P0 | MIG | VERIFIED (LIVE) | Bounded sidecar+admin boundary, admin bound 127.0.0.1 (`pqc-sidecar/src/main.ts:68-74`) | — | — |
| MIG-003 | P0 | SHARED | PARTIAL (LIVE) | Paths in `PROJECT_STATUS §1`, `DEMO_RUNBOOK`; `TRACEABILITY.md` | No single authoritative trust-boundary/endpoint catalog with authN per path | Add a network/trust-boundary document (feeds 04 report) |
| MIG-004 | P0 | SHARED | PARTIAL | Known-limit: core port reachable directly, JWT API still usable (`PROJECT_STATUS §10`) | No enforcement/monitoring of bypass paths | Network policy + egress/ingress controls at deploy |
| MIG-005 | P0 | MIG | VERIFIED (LIVE) | Sidecar forwards payload unmodified, assertion added as header only; `pqc-sidecar/tests/sidecar.test.ts` | — | — |
| MIG-006 | P0 | SHARED | PARTIAL (LIVE) | Deny-by-default; per-peer idempotency; fail-closed | At-least-once audit (`ledger-service/src/app/audit-service.ts:6-14`); telemetry drop-oldest | Transactional outbox for audit; durable telemetry queue |
| MIG-007 | P0 | MIG | VERIFIED (LIVE) | `classical-allowed` → `allowed-fallback`; e2e §3 | — | — |
| MIG-008 | P0 | MIG | VERIFIED (LIVE) | hybrid-required rejects classical; tamper → `handshake-failed`; e2e §3 | — | — |
| MIG-009 | P0 | MIG | VERIFIED (LIVE) | Identity = cert SHA-256 fingerprint, never IP (`pqc-sidecar/src/sidecar/client-cert.ts:41`; D-04) | — | — |
| MIG-010 | P1 | MIG | PARTIAL | `/v1` paths; config schema versioned | No formal API-versioning policy or backward-compat contract tests | Add contract tests + deprecation policy |
| MIG-011 | P1 | MIG | PARTIAL (LIVE) | Config versioning + audit; live profile switch (e2e §5) | "Rollback" = new forward version; no rollback runbook | Document rollback; add rollback test |
| MIG-012 | P1 | MIG | VERIFIED (LIVE) | Per-peer profile (`hybrid-required`/`classical-allowed`); phased switch | — | — |
| MIG-013 | P1 | MIG | PARTIAL | Peer classes covered in scenarios | Only Node/OpenSSL stack; no BCJSSE/Java; no cross-stack interop matrix | Build interop matrix when a 2nd stack exists |
| MIG-014 | P1 | SHARED | VERIFIED | Core unchanged except added partner API; Stage 1 fixes documented (`§7`); tests | — | — |
| MIG-015 | P0 | MIG | VERIFIED (LIVE) | PQ ends at sidecar; sidecar→core plain HTTP+HMAC explicitly documented/labelled (`§10`, C-07) | — (boundary, documented) | — |
| MIG-016 | P1 | MIG | PARTIAL (LIVE) | Config fail-static; telemetry backoff + bounded queue (`pqc-sidecar/src/sidecar/control-plane.ts:135-139,171-173`) | Drop-oldest loses events; no circuit breaker | Durable queue; circuit breaker |

## B. Post-Quantum Cryptography

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| PQC-001 | R/P0 | MIG/RES | VERIFIED (LIVE) | `X25519MLKEM768` (0x11ec, 1216/1120 B) — `pqc-sidecar/tests/wire.test.ts`, e2e §3 | Node/OpenSSL stack only (not Java/BCJSSE named in proposal) | — |
| PQC-002 | R/P0 | MIG/RES | VERIFIED (LIVE) | Group verified from ServerHello on wire (`pqc-sidecar/src/wire/observer.ts`, D-03) | Node can't self-report hybrid group; sole source is wire parse | Cross-check when a TLS stack exposes the group |
| PQC-003 | R/P0 | MIG | VERIFIED (LIVE) | hybrid-required never completes classical; e2e `classical-peer-fallback-forbidden` rejected | — | — |
| PQC-004 | R/P0 | MIG | VERIFIED (LIVE) | Fallback only for `classical-allowed` peer (`pqc-sidecar/src/policy/evaluate.ts:70-78`) | — | — |
| PQC-005 | R/P0 | MIG | VERIFIED (LIVE) | Unknown peer → `rejected-unknown-peer` (`evaluate.ts:53-65`); e2e | — | — |
| PQC-006 | R/P0 | MIG | VERIFIED (LIVE) | `allowed-fallback` reason states "no PQ key-establishment"; provenance badges (`moneypurse-web/tests/lib/provenance.test.ts`) | — | — |
| PQC-007 | R/P0 | MIG | VERIFIED (LIVE) | Structured connection events → security-service (`pqc-sidecar/src/sidecar/types.ts:12-34`) | Events bearer-auth only, not individually signed | Per-event signature (see 05) |
| PQC-008 | R/P0 | MIG | VERIFIED (LIVE) | `rejected-violation` → 403; server-derived severity + alerts (`security-service/src/domain/policy.ts:23-36`) | — | — |
| PQC-009 | R/P0 | MIG/RES | VERIFIED (LIVE) | Visibility limit encoded in scenario + UI + C-05 (`pqc-sidecar/src/peers/scenarios.ts:188-193`) | — | — |
| PQC-010 | R/P0 | MIG | VERIFIED (LIVE) | OpenSSL TLS 1.3 schedule; tamper fails via transcript auth; explicit X.509 checks (`client-cert.ts:44-50`) | — | — |
| PQC-011 | P0 | SHARED | VERIFIED (LIVE) | pino redact; `*/tests/*log-hygiene*`; CBOM key-file refusal (`security-service/src/cbom/sources.ts:160-168`) | Covers exercised paths (C-10) | — |
| PQC-012 | P0 | MIG | VERIFIED (LIVE) | Cert auth independent of KE (`client-cert.ts`) | Single CA, no revocation | OCSP/CRL (see 05) |
| PQC-013 | P0 | MIG | VERIFIED (LIVE) | Status/claim ledger/CBOM classify certs+tokens classical (`security-service/src/domain/status.ts:123`) | — | — |
| PQC-014 | P1 | MIG | VERIFIED (LIVE) | Config versions + hash-chained audit (`security-service/src/services/config-service.ts`) | One selectable provider | — |
| PQC-015 | P1 | MIG | PARTIAL | Group-list configurable in registry | Only X25519MLKEM768+X25519 present; no additional algs/providers wired | Add provider/alg when validated impl exists |
| PQC-016 | P1 | MIG | NOT IMPL (PLANNED) | Out of scope by proposal §21; boundary documented (T-06) | PQ signatures/PKI/JWT migration absent | Separate assurance workstream |
| PQC-017 | R/P0 | RES | VERIFIED (LIVE) | Bench manifest, CBOM, status registry record versions/groups/provider | — | — |
| PQC-018 | P1 | MIG | VERIFIED (LIVE) | Fail-closed: unknown group→reject; bad config kept-prior; unknown peer deny | No enforced OpenSSL floor (silent reject if too old) | Add startup version assertion |

## C. Cryptographic Agility

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| AGI-001 | R/P0 | MIG | VERIFIED (LIVE) | Provider registry (`security-service/src/domain/crypto.ts:50-70`); sidecar config-driven | — | — |
| AGI-002 | R/P0 | MIG | VERIFIED (LIVE) | `validateProfileGroups` rejects non-selectable provider/unknown groups (`crypto.ts:75-87`) | — | — |
| AGI-003 | R/P0 | MIG | VERIFIED (LIVE) | zod + validation before activation; transactional (`config-service.ts:105`) | — | — |
| AGI-004 | R/P0 | MIG/RES | VERIFIED (LIVE) | Live switch verified by new handshake behavior; e2e §5 | — | — |
| AGI-005 | R/P0 | MIG | VERIFIED (LIVE) | Applies to new connections, existing keep; documented (C-06) | — | — |
| AGI-006 | P0 | MIG | VERIFIED (LIVE) | RBAC `config:manage`; auditor cannot change (e2e); config audit chain | — | — |
| AGI-007 | P1 | MIG | PARTIAL | Provider registry marks PLANNED/selectable | No deprecated/expiring config or cert-expiry inventory | Build expiry/deprecation inventory (ties ADV-007) |
| AGI-008 | P1 | MIG | PARTIAL | `security-service/tests/config.test.ts` | No dedicated compat/regression/rollback migration test suite | Add migration test pack |
| AGI-009 | P1 | MIG | VERIFIED | Server-derived severity; validation; audit on change | — | — |
| AGI-010 | P1 | MIG/RES | VERIFIED (LIVE) | `timeToApplyMs` (`config-routes.ts:130`); e2e §5 (3.9–4.9 s) | Wall-clock based (single-host) | Monotonic/clock-skew aware for multi-host |

## D. CBOM & Cryptographic Asset Visibility

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| CBOM-001 | R/P0 | RES | VERIFIED (LIVE) | CycloneDX 1.7, ajv vs vendored schema (`security-service/src/cbom/validate.ts`) | — | — |
| CBOM-002 | R/P0 | RES | VERIFIED (LIVE) | specVersion, generator id, `sourceSummary`, metadata props (`generator.ts:342-365`) | — | — |
| CBOM-003 | R/P0 | RES | VERIFIED (LIVE) | provenance `declared`/`observed` (`generator.ts:101-110,145`) | — | — |
| CBOM-004 | R/P0 | RES | VERIFIED (LIVE) | `pq:not-full-discovery`, `pq:limitations` (`generator.ts:356-359`) | — | — |
| CBOM-005 | R/P0 | RES | PARTIAL | Ground truth scoped (`security-service/ground-truth/cbom-ground-truth.json`) | **Prepared by the same AI agent that wrote the generator; not independent** (`:4`, status.ts:122) | Independent human-prepared ground truth |
| CBOM-006 | R/P0 | RES | VERIFIED (LIVE) | TP/FP/FN, precision/completeness/locationRecall (`compare.ts:84-156`); 24 TP/0 FP/6 FN, completeness 0.80, precision 1.00, loc-recall 0.39 | Precision structurally easy (emits only from sources) | Report completeness/recall as primary |
| CBOM-007 | P1 | RES | PARTIAL | algorithms/deps captured | owners/lifecycle status limited | Enrich asset metadata |
| CBOM-008 | P1 | RES | PARTIAL | On-demand regeneration | Register hand-maintained (maintenance-dependent) | Automate register refresh on dep/code change |
| CBOM-009 | P1 | MIG | PARTIAL | `cbom:read` RBAC | Granted to admin+auditor; cert subjects/issuers/serials in BOM; no field-level redaction | Restrict/redact topology fields |
| CBOM-010 | P1 | MIG | PARTIAL | Typed discrepancies (`compare.ts`) | No linkage to remediation tickets | Link findings → backlog |

## E. Zero-Trust & Application Security

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| SEC-001 | P0 | SHARED | PARTIAL (LIVE) | External sidecar mutual TLS | web↔ledger & admin plain HTTP in prototype; no TLS-termination config | Terminate TLS for all exposed endpoints at deploy |
| SEC-002 | P0 | SHARED | PARTIAL | Bearer tokens + HMAC assertion (`partner/assertion.ts`) | Internal hops plain HTTP; no mTLS internally | mTLS/service mesh for internal comms |
| SEC-003 | P0 | SHARED | VERIFIED (LIVE) | RBAC matrix; deny-by-default peer; guards | — | — |
| SEC-004 | P0 | SHARED | PARTIAL | Admin loopback-bound (`main.ts:68-74`) | No auth on admin/status; deployment-dependent | Authenticate admin; network isolation |
| SEC-005 | P0 | SHARED | VERIFIED (LIVE) | zod validation on every route | — | — |
| SEC-006 | P0 | SHARED | PARTIAL (LIVE) | Parameterized SQL, zod, CSRF originGuard, RBAC, rate limits | No pentest/DAST; no SAST | Pentest + SAST/DAST in CI |
| SEC-007 | P0 | SHARED | NOT IMPL (COND) | — | No app-level encryption at rest; relies on disk/DB | Field/column encryption + encrypted volumes |
| SEC-008 | P0 | SHARED | PARTIAL | `scripts/setup.mjs` gen; file storage; gitignored | No rotation/revocation; single kid | Key rotation + KMS |
| SEC-009 | P0 | SHARED | NOT IMPL | Documented absence | No KMS/HSM | Integrate KMS/HSM for signing/HMAC keys |
| SEC-010 | P0 | SHARED | VERIFIED (mostly) | Nothing sensitive git-tracked; `.secrets/` + `.env` git-ignored | Live secret sits in working-tree `.env` (not committed); test-only literal | Secrets manager; never materialize on disk |
| SEC-011 | P0 | SHARED | VERIFIED (LIVE) | Global 300/min, login 10/min, partner 120/min, maxConnections | In-memory, single-instance | Distributed limiter store |
| SEC-012 | P0 | SHARED | PARTIAL | Staff RBAC strong | Sidecar admin unauthenticated (loopback only); no MFA | Auth admin; add MFA (IAM-001) |
| SEC-013 | P0 | MIG | VERIFIED (LIVE) | Config audit chain, transactional, RBAC | — | — |
| SEC-014 | P0 | SHARED | PARTIAL | `TRACEABILITY.md` threat→req rows (T-01..06) | No STRIDE/full threat-model doc | See 05 report (now authored) |
| SEC-015 | P0 | SHARED | PARTIAL | Stage 1 defects found+fixed (`§7`) | No independent security assessment | Commission external review |
| SEC-016 | P1 | SHARED | NOT IMPL | — | No scanning/CI; locally testable only | Add CI + continuous vuln scanning |

## F. Authentication & Identity

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| IAM-001 | P0 | SHARED | NOT IMPL | — | No MFA for privileged/admin access | Add phishing-resistant MFA (WebAuthn) |
| IAM-002 | P0 | BANK | PARTIAL (LIVE) | scrypt (logN=15), policy, lockout; Supabase email-OTP add-on (C-16) | OTP demo-grade; ES256 classical; no aud check | Harden OTP; verify token `aud` |
| IAM-003 | P0 | SHARED | VERIFIED (LIVE) | Refresh rotation + reuse detection (`identity-service.ts:157-197`); HttpOnly SameSite cookie | security-service honors token until expiry (no introspection) | Token introspection/short TTL |
| IAM-004 | P0 | SHARED | VERIFIED (LIVE) | Guards + ownership checks; APIs enforce, not UI (`http/guards.ts`) | — | — |
| IAM-005 | P0 | SHARED | PARTIAL | Roles + per-peer identity | No multi-tenant construct (single bank) | N/A unless multi-tenant |
| IAM-006 | P0 | MIG | VERIFIED (LIVE) | `config:manage` admin-only; auditor read-only; operator no security perms | — | — |
| IAM-007 | P0 | SHARED | PARTIAL | Forced password change; change-password guarded | No local account-recovery flow (Supabase handles customer) | Define recovery with controls |
| IAM-008 | P1 | SHARED | NOT IMPL | — | No risk-based step-up | Add step-up for sensitive ops |
| IAM-009 | P0 | SHARED | PARTIAL | Disable user → refresh family revoked | Access token honored until expiry in security-service; no access review | Introspection + periodic access review |
| IAM-010 | P1 | SHARED | VERIFIED (LIVE) | `authz.denied` audit; log-hygiene | — | — |

## G. Financial Integrity & Transaction Safety
*Applicability: the ledger-service is a minimal reference core (C-11). These apply to it as a demonstration; a production deployment would externalize many to a real BANK core.*

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| FIN-001 | P0 | BANK | VERIFIED (LIVE) | `assertBalanced` + deferred DB trigger (`migrations/0001_init.sql:43-66`); e2e sum=0 (14 accts) | — | — |
| FIN-002 | P0 | BANK | VERIFIED (LIVE) | `postTransaction` BEGIN/COMMIT (`postgres/ledger-store.ts:120-191`) | — | — |
| FIN-003 | P0 | BANK | VERIFIED (LIVE) | Unique idempotency key, per-user/per-peer scope; replay test | — | — |
| FIN-004 | P0 | BANK | VERIFIED (LIVE) | `FOR UPDATE` sorted ids; no-deadlock integration test | — | — |
| FIN-005 | P0 | BANK | PARTIAL | Postgres durability | Single node; no replication/backup | HA Postgres + backups |
| FIN-006 | P0 | BANK | PARTIAL | Append-only postings (no UPDATE/DELETE) | **Reversals NOT implemented** (`reversed` status unused; no code/endpoint) | Implement reversal/compensating entries |
| FIN-007 | P0 | BANK | VERIFIED (LIVE) | bigint minor units, no float (`domain/money.ts`) | — | — |
| FIN-008 | P0 | BANK | NOT IMPL | Only `posted`/`reversed` (unused) | No pending/accepted/settled/rejected states | Model lifecycle if settlement in scope |
| FIN-009 | P0 | BANK | PARTIAL | Idempotency → safe retry | No settlement/clearing lifecycle; at-least-once audit | Settlement state machine; outbox |
| FIN-010 | P0 | SHARED | PARTIAL | Partner returns after posting | Audit after commit (at-least-once) can lag | Transactional outbox for audit |
| FIN-011 | P0 | SHARED | VERIFIED (LIVE) | correlation id + TLS context on txn & audit (`partner.ts:120-146`) | No external processor leg | — |
| FIN-012 | P0 | BANK | NOT IMPL | — | No reconciliation/balance re-derivation tooling | Reconciliation job vs posting sums |
| FIN-013 | P0 | SHARED | PARTIAL | Balances authoritative from API; React Query `staleTime` | No explicit freshness semantics for projections | Label projection freshness |
| FIN-014 | P1 | BANK | PARTIAL | Concurrency tests (no-deadlock, idempotency race) | No fault-injection/chaos | Add fault-injection tests |

## H. Reliability & Availability

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| REL-001 | P0 | SHARED | NOT IMPL | Target proposed only | No SLOs defined/measured | Define + measure SLOs |
| REL-002 | P0 | SHARED | NOT IMPL | — | Single host, single Postgres, in-memory state = multiple SPOFs | HA topology |
| REL-003 | P0 | SHARED | PARTIAL | SIM widgets isolated; telemetry non-blocking | security-service down → sidecar not ready | Degrade-gracefully design |
| REL-004 | P0 | SHARED | PARTIAL | Idempotency preserved | In-memory counters/queues lost on restart | Durable state |
| REL-005 | P0 | SHARED | PARTIAL | Sidecar timeouts, telemetry backoff/bounded queue | No circuit breakers | Add circuit breakers/backpressure tests |
| REL-006 | P0 | SHARED | PARTIAL | `/healthz` all; `/readyz` security-service only | No `/readyz` on ledger/sidecar; no `/livez` | Add readiness/liveness everywhere |
| REL-007 | P0 | SHARED | NOT IMPL | — | No failover | Redundancy + failover |
| REL-008 | P0 | SHARED | NOT IMPL | — | No backup/recovery | Backups + restore tests |
| REL-009 | P0 | SHARED | NOT IMPL | — | No RPO/RTO | Define per service |
| REL-010 | P0 | BANK | UNVERIFIED | Single-node durability only | No data-loss objective evidence | HA + RPO validation |
| REL-011 | P0 | SHARED | NOT IMPL | — | No DR test | DR exercises |
| REL-012 | P1 | SHARED | NOT IMPL | — | No AZ-loss recovery | Multi-AZ |
| REL-013 | P1 | SHARED | NOT IMPL | — | Deps not in continuity plan | BCP |
| REL-014 | P1 | SHARED | NOT IMPL | — | No chaos testing | Chaos in nonprod |

## I. Performance & Scalability

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| PERF-001 | P0 | SHARED | NOT IMPL | — | No API latency SLOs | Define |
| PERF-002 | P0 | SHARED | NOT IMPL | — | No SLO measurement vs workload | Define + measure |
| PERF-003 | P0 | SHARED | UNVERIFIED | — | No API load tests | Load test suite |
| PERF-004 | P0 | MIG/RES | VERIFIED (LIVE) | Bench isolates handshake latency (`pqc-sidecar/src/bench`) | — | — |
| PERF-005 | R/P0 | RES | VERIFIED (LIVE) | Interleaved, identical conditions, manifest | — | — |
| PERF-006 | R/P0 | RES | VERIFIED (LIVE) | Percentiles, bootstrap CIs, throughput, CPU (coarse), failures | CPU coarse on Windows | — |
| PERF-007 | R/P0 | RES | PARTIAL | Full-handshake benchmark, no resumption | Resumed sessions NOT benchmarked | Add resumption benchmark |
| PERF-008 | P0 | SHARED | PARTIAL | Bounded telemetry queue; maxConnections | Drop-oldest = event loss; no per-peer conn-rate limit | Durable queue; conn-rate limit |
| PERF-009 | P1 | SHARED | NOT IMPL | — | In-memory limits break under horizontal scale | Shared state |
| PERF-010 | P1 | RES | PARTIAL | Handshake bench repeatable | No API load/stress/spike/soak | Add load tests |
| PERF-011 | P1 | SHARED | PARTIAL | Audit paged 500; telemetry cursor; body limits | CBOM/exports no explicit resource bounds | Bound expensive ops |
| PERF-012 | P1 | SHARED | NOT IMPL | — | No capacity planning | Capacity model |
| PERF-013 | P0 | SHARED | PARTIAL | Balances authoritative; no stale-final mislabel found | No explicit freshness indicator | Freshness labels |
| PERF-014 | P1 | SHARED | PARTIAL | Separate `security` DB | Shared Postgres server | Isolate analytics resources |

## J. Data Privacy & Protection

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| DATA-001 | P0 | SHARED | PARTIAL | Separate banking/security DBs; secrets isolated | No formal data classification | Classification policy |
| DATA-002 | P0 | COND | PARTIAL | Minimal fields collected | No privacy policy; demo context | Lawful-basis/minimization review |
| DATA-003 | P0 | SHARED | VERIFIED (LIVE) | Ownership checks; separate DBs; per-peer | — | — |
| DATA-004 | P0 | SHARED | VERIFIED (LIVE) | redact; log-hygiene; HNDL toy-only | — | — |
| DATA-005 | P0 | SHARED | VERIFIED | Seed demo data; isolated test DBs | — | — |
| DATA-006 | P0 | COND | NOT IMPL | — | No retention/destruction policy | Define retention |
| DATA-007 | P0 | SHARED | NOT IMPL | — | No backup → nothing to protect | With backups, encrypt them |
| DATA-008 | P0 | SHARED | PARTIAL | CSV/CBOM downloads authenticated + authz | No DSAR/personal-data export | Add if regulated |
| DATA-009 | P0 | COND | NOT IMPL | Supabase hosted (cross-border) flagged (C-16) | Not assessed per jurisdiction | Data-residency assessment |
| DATA-010 | P1 | SHARED | VERIFIED (LIVE) | Tracked migrations + tests; FK backfill | No down-migrations | Add reversible migrations |
| DATA-011 | P1 | SHARED | PARTIAL | Single authoritative store; staleTime | No replica consistency model | Define if replicas added |
| DATA-012 | P0 | SHARED | PARTIAL | HNDL toy-only; CBOM ground truth AI-prepared offline | Supabase receives customer email/password (external, cross-border) | Assess/consent for external identity |

## K. Observability & Auditability

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| OBS-001 | P0 | SHARED | VERIFIED (LIVE) | Both hash-chained audit logs | — | — |
| OBS-002 | P0 | SHARED | VERIFIED (LIVE) | Audit fields: time/actor/op/resource/outcome/correlation | — | — |
| OBS-003 | P0 | SHARED | VERIFIED (LIVE) | Hash chain + append-only triggers | Superuser bypass; tip not externally anchored | External head-hash anchor |
| OBS-004 | P0 | SHARED | VERIFIED (LIVE) | Toy message not logged; log-hygiene | — | — |
| OBS-005 | P0 | SHARED | NOT IMPL | — | No metrics/Prometheus/`/metrics` | Add metrics |
| OBS-006 | P0 | SHARED | PARTIAL | Correlation id sidecar→core→audit | No distributed tracing (OTel) | Add tracing |
| OBS-007 | P0 | MIG/RES | VERIFIED (LIVE) | Expected vs observed in experiments/telemetry | — | — |
| OBS-008 | P0 | SHARED | PARTIAL | Severity + alerts + ack in-app | No alerting pipeline (paging/email) | Integrate alerting |
| OBS-009 | P0 | SHARED | VERIFIED (LIVE) | Telemetry queries, audit, evidence dir | — | — |
| OBS-010 | P1 | SHARED | PARTIAL | e2e checks ops | No continuous synthetic monitoring | Add synthetics |
| OBS-011 | P1 | SHARED | PARTIAL | RBAC `audit:read` | No retention policy | Define retention |
| OBS-012 | P1 | SHARED | PARTIAL | BIGSERIAL seq ordering | Wall-clock staleness, no NTP (single-host) | Clock-skew handling multi-host |

## L. API & Fintech Interoperability

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| API-001 | P0 | SHARED | PARTIAL | `/v1` paths; zod schemas | No OpenAPI spec | Publish OpenAPI |
| API-002 | P0 | SHARED | VERIFIED (LIVE) | Guards across routes | — | — |
| API-003 | P0 | SHARED | VERIFIED (LIVE) | Error envelope {code,message,requestId}; generic messages | — | — |
| API-004 | P0 | BANK | VERIFIED (LIVE) | Idempotency keys on mutations | — | — |
| API-005 | P0 | MIG | PARTIAL | Sidecar assertion = HMAC + 30s window + method/path bind | No `jti`/nonce → replay within window; no general webhooks | Add nonce/jti |
| API-006 | P0 | SHARED | PARTIAL | Telemetry idempotent by id | Limited async; no ordering guarantees | As needed |
| API-007 | P0 | SHARED | PARTIAL | Supabase fallback; config fail-static; telemetry backoff | security-service down → sidecar not ready | Graceful degradation |
| API-008 | P1 | MIG | PARTIAL | Partner tests | No external partner contract/sandbox | Partner sandbox + contract tests |
| API-009 | P1 | COND | NOT IMPL | — | ISO 20022 not implemented | Add if payments-messaging in scope |
| API-010 | P1 | COND | NOT IMPL | — | No open-banking consent | Add if open-banking in scope |
| API-011 | P1 | COND | N/A | Simulator is an isolated test tool | — | — |
| API-012 | P1 | SHARED | PARTIAL | Lockfiles + CBOM crypto-lib scan | No full dependency risk assessment/SBOM | Dependency SBOM + scanning |

## M. Software Architecture & Maintainability

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| ARCH-001 | P0 | SHARED | VERIFIED (LIVE) | Separate services; hexagonal ledger; sidecar isolated | — | — |
| ARCH-002 | P0 | SHARED | VERIFIED (LIVE) | APIs enforce; frontend hiding is convenience | — | — |
| ARCH-003 | P0 | SHARED | PARTIAL | Config schema + `/v1` | No formal interface docs/OpenAPI | Document interfaces |
| ARCH-004 | P0 | MIG | VERIFIED (LIVE) | Provider registry + ConfigClient schema; switch tested | — | — |
| ARCH-005 | P0 | SHARED | PARTIAL | `setup.mjs` idempotent; `.env.example` | No IaC/containers for apps | Containerize + IaC |
| ARCH-006 | P0 | SHARED | PARTIAL | Tracked migrations, per-file tx | No down-migrations/recovery procedure | Reversible migrations |
| ARCH-007 | P1 | SHARED | VERIFIED | ADRs D-01..09 (`PROJECT_STATUS §3`) | — | — |
| ARCH-008 | P1 | SHARED | VERIFIED | Separate services + DBs | — | — |
| ARCH-009 | P1 | SHARED | VERIFIED | ports/adapters; tests | — | — |
| ARCH-010 | P1 | SHARED | PARTIAL | Good runbook | README drift (web); no per-service ops docs | Fix README; add ops docs |
| ARCH-011 | P1 | MIG | VERIFIED | Provider registry + group-list config | — | — |
| ARCH-012 | P1 | SHARED | N/A | Not multi-tenant | — | — |

## N. DevSecOps & Software Supply Chain

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| OPS-001 | P0 | SHARED | PARTIAL | Git VCS | No branch protection/PR gates (local repo) | Protected branches + reviews |
| OPS-002 | P0 | SHARED | NOT IMPL | — | **No CI at all** | Add CI running test:all + lint + claim-audit |
| OPS-003 | P0 | SHARED | NOT IMPL | — | No dep/image scanning | Dependabot/Snyk/Trivy |
| OPS-004 | P0 | SHARED | PARTIAL | Lockfiles; bench manifest commit | No build provenance pipeline | SLSA-style provenance |
| OPS-005 | P0 | SHARED | NOT IMPL | Evidence files checksummed | No release artifact signing | Sign releases |
| OPS-006 | P0 | SHARED | VERIFIED (mostly) | gitignored secrets | No secrets manager | Secrets manager |
| OPS-007 | P0 | SHARED | NOT IMPL | — | No deploy/rollback pipeline | CD with rollback |
| OPS-008 | P0 | SHARED | PARTIAL | Migrations exist | No expand/contract/blue-green doc | Document strategy |
| OPS-009 | P0 | SHARED | PARTIAL | Stage 1 findings tracked in docs | No vuln-management process/SLAs | Vuln management |
| OPS-010 | P1 | SHARED | PARTIAL | CBOM (crypto) present | No dependency SBOM | Generate CycloneDX dep SBOM |
| OPS-011 | P1 | SHARED | NOT IMPL | — | No IaC | Terraform/Helm |
| OPS-012 | P1 | SHARED | PARTIAL | DEMO_RUNBOOK | No ops/on-call runbooks or ownership | Author runbooks |
| OPS-013 | P1 | SHARED | NOT IMPL | — | No release gates | Gate releases in CI |
| OPS-014 | P1 | SHARED | NOT IMPL | — | No controlled rollout/recovery | Progressive delivery |

## O. User Experience & Accessibility

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| UX-001 | P0 | SHARED | PARTIAL | Radix primitives, aria/roles (65 occ/25 files), text-labelled badges, tabular nums | No automated a11y testing/WCAG conformance evidence; `aria-live` unverified | axe/jest-axe; manual WCAG audit |
| UX-002 | P0 | SHARED | VERIFIED (LIVE) | Transfer confirm/error, signup states, error boundaries | — | — |
| UX-003 | P0 | SHARED | VERIFIED (LIVE) | SIM/SIMULATED/PLANNED badges; honesty tests; claim-audit | — | — |
| UX-004 | P0 | SHARED | VERIFIED (LIVE) | AuthGate + API enforce; 404 opacity | — | — |
| UX-005 | P1 | SHARED | PARTIAL | Responsive design | Sidebar desktop-only; no viewport matrix | Mobile nav; document viewports |
| UX-006 | P1 | SHARED | VERIFIED | Shared UI kit/design system | — | — |
| UX-007 | P1 | COND | NOT IMPL | English only (`lang="en"`) | No Bengali localization (BD market) | Add i18n + Bengali |
| UX-008 | P0 | SHARED | VERIFIED (LIVE) | `formatCurrency` bigint, ৳/BDT, tabular, dates (`lib/format.ts`) | — | — |
| UX-009 | P1 | SHARED | PARTIAL | Transfer retry + idempotency; error states | Limited uncertain-outcome messaging | Improve messaging |
| UX-010 | P1 | SHARED | VERIFIED | Badges carry text, not color-only | — | — |

## P. Regulatory & Organizational Governance

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| GOV-001 | P0 | COND | NOT IMPL | — | No per-jurisdiction obligation mapping | Regulatory analysis |
| GOV-002 | P0 | SHARED | PARTIAL | Claim ledger/traceability map claims→evidence | No named control owners | Assign owners |
| GOV-003 | P0 | SHARED | PARTIAL | Limitations + gaps lists | No formal risk register | Risk register |
| GOV-004 | P0 | MIG | VERIFIED (LIVE) | RBAC + config audit + SoD | — | — |
| GOV-005 | P0 | SHARED | NOT IMPL | — | No incident-response plan | IR plan |
| GOV-006 | P0 | COND | NOT IMPL | — | Supabase (critical provider) unassessed | Provider assessment |
| GOV-007 | P0 | COND | PARTIAL | Audit chains | No retention policy | Retention policy |
| GOV-008 | P0 | SHARED | VERIFIED (LIVE) | Claim ledger, status registry, claim-audit guard | — | — |
| GOV-009 | P1 | SHARED | NOT IMPL | — | No BCP | BCP |
| GOV-010 | P1 | SHARED | PARTIAL | Evidence dir, audit chains | No formal audit-evidence package | Audit pack |
| GOV-011 | P1 | MIG | PARTIAL | Living docs updated | No review cadence | Schedule reviews |
| GOV-012 | P0 | SHARED | VERIFIED (LIVE) | Explicit disclaimers; claim-audit guard | — | — |

## Q. Research Reproducibility & Validity

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| RES-001 | R | RES | VERIFIED (LIVE) | `classical-baseline` profile; bench classical arm | — | — |
| RES-002 | R | RES | VERIFIED (LIVE) | Hybrid profile; bench hybrid arm | — | — |
| RES-003 | R | RES | VERIFIED (LIVE) | IVs: profile/capability/policy/concurrency (scenarios + bench) | — | — |
| RES-004 | R | RES | VERIFIED (LIVE) | handshake timing/size/throughput/resource/success-fail | — | — |
| RES-005 | R | RES | VERIFIED (LIVE) | Raw CSV + checksums before aggregation | — | — |
| RES-006 | R | RES | VERIFIED (LIVE) | manifest.json exact sw/hw/config | — | — |
| RES-007 | R | RES | VERIFIED (LIVE) | warmup, no-resumption, interleaving | — | — |
| RES-008 | R | RES | VERIFIED (LIVE) | permitted/forbidden fallback + unknown peer scenarios | — | — |
| RES-009 | R | RES | VERIFIED (LIVE) | tamper scenario documents modified/observed/not-inferable | — | — |
| RES-010 | R | RES | PARTIAL | Scoped ground truth | **Not independent (AI-prepared, same agent)** | Independent human ground truth |
| RES-011 | R | RES | VERIFIED (SIM) | Simulator disclaimers + tests; no cryptanalysis | — | — |
| RES-012 | R | RES | VERIFIED (LIVE) | Before/after config verified (e2e §5) | — | — |
| RES-013 | R | RES | VERIFIED (LIVE) | Status registry + badges + honesty tests | — | — |
| RES-014 | R | RES | VERIFIED (LIVE) | Claim ledger H1–H6 separates hypotheses/results | — | — |
| RES-015 | R | RES | VERIFIED (LIVE) | Claim ledger evidence paths; status test enforces existence | — | — |
| RES-016 | R | RES | VERIFIED (LIVE) | Invalid bench runs kept + explained; limitations sections | — | — |
| RES-017 | R | RES | VERIFIED (LIVE) | `TRACEABILITY.md` threat→req→mechanism→test→evidence | — | — |
| RES-018 | R | RES | PARTIAL | Caveats scattered (loopback/single-host/paired diffs) | No consolidated internal/external/construct/conclusion validity section | Add validity-threats section |

## R. Operational Maturity & Advanced Controls

| ID | Pri | Appl | Status (Type) | Evidence | Gap | Remediation |
|---|---|---|---|---|---|---|
| ADV-001 | P1 | SHARED | NOT IMPL | — | No SLOs/error budgets | Define |
| ADV-002 | P1 | SHARED | NOT IMPL | — | No backup-restore/DR exercises | Schedule |
| ADV-003 | P1 | MIG | VERIFIED (LIVE) | Telemetry decisions, console, provenance badges | — | — |
| ADV-004 | P1 | MIG | PARTIAL | Per-peer decisions visible | No aggregate migration-coverage metric | Coverage dashboard |
| ADV-005 | P1 | SHARED | NOT IMPL | Bench CPU coarse | No cost attribution | Cost model |
| ADV-006 | P1 | MIG | PARTIAL | Config audit history | No incident log | Incident tracking |
| ADV-007 | P1 | MIG | NOT IMPL | — | No cert-expiry monitoring/renewal | Cert lifecycle monitor |
| ADV-008 | P1 | MIG | PARTIAL | Sidecar reports applied version/staleness | No drift detection | Drift detection |
| ADV-009 | P2 | SHARED | NOT IMPL | — | No multi-region | If needed |
| ADV-010 | P2 | MIG | NOT IMPL | — | No anomaly detection | If needed, keep explainable |
| ADV-011 | P0 | SHARED | VERIFIED (by absence) | No AI in runtime; CBOM ground truth AI-prepared offline, flagged for human review | No autonomous AI action on crypto/txns | Keep human-in-loop; review ground truth |
| ADV-012 | P1 | SHARED | VERIFIED | YAGNI discipline; SIM features labelled, not overclaimed | — | — |

---

## Status roll-up (all 236 applicable requirements counted)

| Status | Count |
|---|---|
| VERIFIED | 92 |
| PARTIAL | 70 |
| NOT IMPL | 58 |
| UNVERIFIED | 2 |
| BLOCKED | 0 |
| N/A | 3 |
| NOT IMPL (PLANNED, documented out of scope) | included in NOT IMPL above (PQC-016) |

By priority (applicable): **R** 18 → 15 VERIFIED, 3 PARTIAL. **R/P0** crypto core → predominantly VERIFIED. **P0** → heavily split: prototype crypto/financial/identity/audit mostly VERIFIED; production reliability/DR/perf-SLO/KMS/CI mostly NOT IMPL. **P1/P2** → mixed, production-hardening NOT IMPL.

> Counts are approximate groupings for orientation; the authoritative status is the per-row table above. BLOCKED is 0 because every requirement could be assessed from the repository; production controls that require external infrastructure are recorded as NOT IMPL with remediation rather than BLOCKED, since nothing prevented their assessment.
