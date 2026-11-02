# Hybrid Post-Quantum Banking Migration Platform

A **research prototype** for the paper *"A Hybrid Post-Quantum Migration Architecture for
Legacy-Style Digital Banking: Sidecar-Based TLS 1.3 Key Establishment, Cryptographic Agility and
CBOM-Driven Visibility."* It shows how a bank can adopt post-quantum cryptography incrementally by
putting a **sidecar** in front of an unchanged core, negotiating **hybrid TLS 1.3
(`X25519MLKEM768`)**, enforcing per-peer crypto policy, and keeping a cryptographic bill of materials.

> **Not production.** This is a prototype. It does not claim production readiness, regulatory
> compliance, certification, or complete quantum resistance. Hybrid protection is **key establishment
> only**, on the sidecar's connections; certificates and token signatures are **classical** (ECDSA /
> EdDSA / ES256). See `docs/CLAIM_LEDGER.md` for every claim and its evidence.

## Components

| Service | Role | Port(s) |
|---|---|---|
| **`pqc-sidecar`** | The PQ-migration gateway: terminates TLS 1.3, negotiates hybrid/classical, verifies the negotiated group on the wire, enforces per-peer policy, signs a peer assertion to the core | TLS 8443, admin 8081 |
| **`ledger-service`** | Reference banking core + identity provider: double-entry ledger, idempotency, reversals, RBAC auth (EdDSA JWT + JWKS), hash-chained audit, partner API, KMS-encrypted PII | 3000 |
| **`security-service`** | Security control plane: peer/provider/TLS-profile registries, versioned audited config, telemetry, **CBOM** (CycloneDX 1.7), **HNDL** simulator, benchmark evidence, status registry | 3200 |
| **`moneypurse-web`** | Next.js console: customer dashboard, operator and security consoles | 3100 |
| peer-simulator | Simulated external peers + controlled ClientHello-tamper proxy (in `pqc-sidecar`) | 3300 |

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full architecture and a source-code roadmap.

## Repository map

```
ledger-service/     reference banking core + identity (hexagonal: domain/ports/adapters/app/http)
security-service/   security control plane (registries, config, telemetry, CBOM, HNDL, benchmarks)
pqc-sidecar/        the PQ-migration gateway (TLS, wire parsing, policy, PKI, mTLS, bench, peers)
moneypurse-web/     Next.js web console (app/ components/ hooks/ lib/)
deploy/             Dockerfiles live in each service; compose + local HA Postgres here
scripts/            orchestration: setup, e2e, bench, claim-audit, db backup/restore, register peers
docs/               living docs (PROJECT_STATUS, CLAIM_LEDGER, TRACEABILITY, runbook) + audits/
evidence/           retained, checksummed e2e and benchmark runs
.github/workflows/  CI gate (test suites, claim-audit, dependency scan, SBOM)
```

## Quickstart

Prerequisites: Node 26 (OpenSSL ≥ 3.5 — required for `X25519MLKEM768`), Docker, Git.

```bash
npm run install:all     # install every workspace
npm run setup           # per-service .env, secrets, research PKI (idempotent)
npm run db:up           # PostgreSQL in Docker
npm run migrate && npm run seed
# then, each in its own terminal:
npm run dev:ledger      # :3000    npm run dev:security  # :3200
npm run dev:sidecar     # :8443/8081   npm run dev:simulator # :3300
npm run dev:web         # :3100
npm run register-peers
```

Verify:

```bash
npm run test:all        # ledger + security + sidecar + web suites (needs the Postgres container)
npm run e2e             # drives the live stack; writes evidence/e2e/<run>/
npm run claim-audit     # scans for over-claiming language
npm run db:backup [db] && npm run db:restore <dump> <targetDb>
```

Full demo script: **`docs/DEMO_RUNBOOK.md`**.

## Documentation
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — architecture + source-code roadmap.
- `docs/PROJECT_STATUS.md` — living status (LIVE/SIM/PLANNED), decisions, limitations, remediation log.
- `docs/CLAIM_LEDGER.md` — every claim with evidence and limits. `docs/TRACEABILITY.md` — threat→requirement→mechanism→test.
- `docs/audits/` — the independent NFR audit (00–09), the staged plan (11), hop-protection (12), HA/DR (13), CBOM ground truth (14).
- `docs/IMPLEMENTATION_PLAN.md` — the remediation roadmap.

## Status
Post-audit remediation M0–M9 is implemented, tested and merged (CI gate; replay-proof assertions;
atomic audit; Supabase hardening; key rotation + KMS PII encryption; reversals + reconciliation;
health/metrics; internal mTLS + PKI; verified backup/restore + container/IaC artifacts; independent
CBOM template). Remaining items need **external infrastructure** (cloud KMS/HSM, at-rest volume
encryption, HA replication, PITR, offsite backups, k8s, edge/DB TLS, OCSP) or an **independent human**
(the CBOM sign-off); these are labelled INFRA/HUMAN in `docs/audits/11_STAGED_PLAN_M4_M9.md` and are
not claimed done.
