# Verification and Test Plan

## What exists today (re-verified this audit)
`npm run test:all` → **617 passed, 0 failed** (ledger 150, security 144 on real PostgreSQL, sidecar 113 on real TLS 1.3, web 210). Live e2e recorded 50/50 (`evidence/e2e/2026-11-01T00-24-56-403Z/`). Benchmark valid run with CIs. `claim-audit` 0 un-negated. A status-registry test fails if any LIVE/SIM component cites non-existent evidence.

Real-vs-mock note: sidecar `wire`/`sidecar`/`scenarios`/`bench` suites and security-service integration suites use **real** OpenSSL TLS 1.3 handshakes and real PostgreSQL; control-plane/telemetry/assertion unit tests use fakes.

## Requirement → existing test traceability (representative)
| Requirement | Existing test(s) |
|---|---|
| PQC-001/002 hybrid + wire-verify | `pqc-sidecar/tests/wire.test.ts`, `sidecar.test.ts`; e2e §3 |
| PQC-003/004/005 fallback/deny | `pqc-sidecar/tests/{policy,scenarios}.test.ts`; e2e §3 |
| PQC-009 visibility limit | `pqc-sidecar/tests/scenarios.test.ts:165-173` |
| AGI-004/010 live switch | `security-service/tests/config.test.ts`; e2e §5 |
| FIN-001 double-entry | `ledger-service/tests/domain/ledger.test.ts`, `adapters/postgres-ledger-store.integration.test.ts:193`; e2e §4 |
| FIN-003/004 idempotency/concurrency | `postgres-ledger-store.integration.test.ts` (unique-key race, no-deadlock) |
| IAM-003 refresh rotation/reuse | `ledger-service/tests/http/auth.test.ts` |
| OBS-001/003 audit chains | `ledger-service/tests/audit/chain.test.ts`, `postgres-identity-audit.integration.test.ts`; `security-service/tests/audit.test.ts` |
| CBOM-001/006 schema+compare | `security-service/tests/cbom.test.ts` |
| RES-005/006 raw data + manifest | `pqc-sidecar/tests/bench.test.ts`; `evidence/bench/.../` |
| UX-003 SIM labelling | `moneypurse-web/tests/components/dashboard/honesty.test.tsx` |
| Secrets-in-logs | `*/tests/*log-hygiene*` |

## Missing / recommended tests

### Unit
- Assertion `jti`/nonce single-use (T-P0-1); Supabase `aud` rejection (T-P0-3); reversal balancing + double-reversal block (T-P0-6); key-rotation `kid` verification (T-P0-5).

### Integration
- Outbox atomicity: crash-after-commit yields exactly one audit event (T-P0-2).
- Reconciliation: injected balance drift detected (T-P0-7).
- Token introspection: disabled user blocked before expiry in security-service (IAM-009).
- Postgres-TLS connection; migration down/rollback (ARCH-006, DATA-010).

### TLS interoperability
- Second stack (BCJSSE) vs Node/OpenSSL matrix (MIG-013, PQC-015).
- Revocation: revoked peer cert rejected (OCSP/CRL) (PQC-012).
- OpenSSL-floor guard: too-old runtime fails loudly at startup (PQC-018).

### Performance benchmarks
- Session-resumption arm, reported separately (RES-007/PERF-007).
- API load/stress/spike/soak with latency SLOs (PERF-001/002/003/010).
- Cross-machine + `--preset full` (RES; cross-host).

### Security tests
- SAST/DAST + dependency/container scanning in CI (OPS-003, SEC-016).
- Authz fuzzing across role×endpoint (extend `rbac.test.ts`); replay/forgery of assertion over the wire; rate-limit-under-scale (distributed store).
- Secret-scanning of the repo in CI.

### Financial integrity
- Concurrency fault-injection (partial failure mid-posting) (FIN-014).
- Idempotency under crash/retry across the outbox (FIN-009).
- Settlement/clearing lifecycle if adopted (FIN-008).

### Failover & recovery
- Backup restore drill; primary failover; AZ-loss recovery; chaos experiments in nonprod (REL-007..014).

### CBOM validation
- Re-run completeness/precision/recall against **independent** ground truth (T-R-1); location-recall tracking over time; regression when a crypto dependency is added.

### Research reproducibility
- Automated reproduction from a clean checkout in CI (health + scenarios subset); evidence checksum verification; validity-threats documented (RES-018).

## Safe verification commands (runnable locally, non-destructive)
```bash
npm run test:all            # 617 tests (needs Postgres via npm run db:up)
npm run claim-audit         # restricted-phrase scan
npm run db:up && npm run migrate && npm run seed
npm run e2e                 # needs all 5 services running (dev:*) + register-peers
npm run bench -- --preset quick   # fast handshake benchmark (writes evidence/bench/<run>/)
```
e2e requires ledger:3000, security:3200, sidecar:8443/8081, simulator:3300, web:3100 all up, then `npm run register-peers`. The login limiter throttles repeated e2e runs (wait a minute).

## Not executed this audit (recorded evidence relied upon)
Full 5-service live e2e (only ledger+web were running); evidence SHA-256 recomputation; cross-process sidecar↔core assertion exercise; `.secrets/` key contents. These are the audit's execution limitations.
