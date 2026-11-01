# Executive Assessment

**System:** Hybrid Post-Quantum Banking Migration Platform (`pq-banking-prototype`)
**Audit date:** 2026-11-02 · **Type:** independent, read-only non-functional-requirements audit · **No application code was modified.**

---

## 1. Product definition (as actually built)

The repository implements the research prototype described in *"A Hybrid Post-Quantum Migration Architecture for Legacy-Style Digital Banking."* It is **a cryptographic-migration platform demonstrated against a minimal reference banking core**, not a production bank. The project's own documents state this plainly and a CI-style guard (`scripts/claim-audit.mjs`) blocks over-claiming language.

Four services + a web console:
- **`pqc-sidecar`** — a TLS 1.3 terminating sidecar that negotiates **hybrid `X25519MLKEM768`** (or classical X25519) with mutual-TLS peers, verifies the negotiated group from the wire, enforces per-peer policy, and forwards to the core over plain HTTP with an HMAC-signed assertion.
- **`ledger-service`** — a hexagonal reference core: double-entry ledger, identity/RBAC/audit, partner API. Also the identity provider (EdDSA JWT + JWKS) and a Supabase ES256 add-on identity layer.
- **`security-service`** — control plane: peer/provider/TLS-profile registries, versioned audited config, telemetry, **CycloneDX 1.7 CBOM**, **HNDL educational simulator**, benchmark-evidence ingestion, implementation-status API.
- **`moneypurse-web`** — Next.js console for customers (dashboard), operators and security staff (security console).

## 2. Actual current architecture (AS-IS)

```
 peer-simulator (holds its own CA/peer keys)
   │  TLS 1.3, mutual TLS, X25519MLKEM768 or X25519   ← PQ protection boundary
   ▼
 pqc-sidecar ──(config pull, telemetry push; bearer token, HTTP)──▶ security-service ──┐
   │  plain HTTP + HMAC-signed assertion (private net)                                 │ JWT (JWKS)
   ▼                                                                                    ▼
 ledger-service (accounts, ledger, identity/RBAC, audit) ◀───── JWT ───── moneypurse-web
   │
 PostgreSQL (databases: ledger, security)
```

Boundaries (by design): certificates and token signatures are **classical** (ECDSA P-256 / EdDSA / ES256); hybrid protection covers **key establishment only**, on the sidecar's connections; the sidecar→core hop is plain HTTP on a private network; no HSM/KMS; single host, single Postgres server, loopback. See `04_ARCHITECTURAL_GAPS.md`.

## 3. Main implementation findings

- **The research core works and is verified end-to-end.** Fresh `npm run test:all` this audit: **617/617 pass** (ledger 150, security 144 on real Postgres, sidecar 113 on real TLS 1.3, web 210). Recorded live e2e: **50/50** (`evidence/e2e/2026-11-01T00-24-56-403Z/`). Hybrid negotiation, group-from-wire verification, deny-by-default peer identity, permitted/forbidden fallback, controlled ClientHello tamper (fails via transcript auth), live crypto-agility switch, double-entry sum-to-zero, both audit hash-chains, CBOM validation, HNDL simulator — all demonstrated against the running stack.
- **Scientific hygiene is strong.** Interleaved, warm-up-controlled benchmark with bootstrap CIs over runs, a 0.5%-failure validity gate, and **two invalid runs kept and explained** rather than deleted. A restricted-phrase guard passes (0 un-negated over 250 files). Claims are mapped to evidence in `docs/CLAIM_LEDGER.md` and a threat→requirement→mechanism→test matrix in `docs/TRACEABILITY.md`.
- **Production scaffolding is largely absent — and honestly declared.** No CI/CD, no app containers/IaC, no dependency SBOM or vulnerability scanning, no metrics/tracing, no backups/DR, no SLOs, no KMS/HSM, no MFA, no reconciliation tooling, no Bengali localization.

## 4. Research readiness

**RESEARCH VALIDATED, with one material caveat.** 15 of 18 research requirements VERIFIED; 3 PARTIAL. The baseline/hybrid comparison, measured handshake cost (H1 +~1176/1088 B hello bytes; H2 +~0.27 ms, 95% CI 0.15–0.38 ms), policy scenarios, agility experiment, HNDL simulator and reproducibility manifests are all defensible.
**Caveat (blocks a clean CBOM research claim):** the CBOM ground truth was **prepared by the same AI agent that wrote the generator** (`RES-010`, `CBOM-005`) — not independent. Its completeness/precision figures need independent human-prepared ground truth before publication. Benchmarks are also single-host loopback (no capacity claim), and a formal validity-threats section (internal/external/construct/conclusion) is not consolidated (`RES-018`).

## 5. Production readiness

**PRE-PRODUCTION (research prototype).** It is **not** a "production technically candidate": multiple applicable P0 technical gates are unmet — no DR/backup evidence (REL-008/009/011), no availability design (REL-002/007), no at-rest encryption (SEC-007), no KMS/HSM (SEC-009), no MFA (IAM-001), no CI/scanning (OPS-002/003), no reconciliation (FIN-012), reversals unimplemented (FIN-006/008). This is consistent with the declared scope; it is not a defect to be "fixed" before the research is valid, but it is a hard blocker for real banking operations.

## 6. Critical security risks (ranked) — see `05_SECURITY_AND_THREAT_AUDIT.md`

1. **Replayable partner assertion within a 30 s window** — HMAC has no `jti`/nonce; a captured assertion can be replayed to the same method+path for 30 s (`pqc-sidecar/src/sidecar/assertion.ts:58-62`). Any core holding the verify secret can also mint assertions. (API-005)
2. **At-least-once audit for money movements** — a ledger posting commits in a separate transaction from its audit event; a failure after commit leaves a durable posting with no audit record until a client retry (`ledger-service/src/app/audit-service.ts:6-14`). (FIN-010, OBS-003)
3. **Supabase token `aud` not verified + auto-provisioning** — any valid token from the configured Supabase project is accepted and auto-creates a bank customer (`ledger-service/src/adapters/supabase/verifier.ts:37-40`). (IAM-002)
4. **No at-rest encryption / no KMS-HSM / single signing key, no rotation** — signing key is a PEM on disk; HMAC secret is a plain env string. (SEC-007/008/009)
5. **Unauthenticated admin/status endpoints** (loopback-only), **plain-HTTP internal hops**, **no cert revocation, single CA**. (SEC-002/004/012, PQC-012)
6. **In-memory rate limits & audit tip not externally anchored** — limits reset per instance; newest-event truncation is only detectable against an external head hash. (SEC-011, OBS-003)

## 7. Top architectural weaknesses

Single-host, no HA/DR; in-memory state (registry, counters, telemetry queue) lost on restart; no CI/containers/IaC; no observability stack (metrics/tracing); reversals and richer transaction lifecycle absent; no reconciliation; sidecar→core plain HTTP; classical authentication throughout.

## 8. Main missing capabilities

CI/CD + security scanning + dependency SBOM; deployment/containerization/IaC; backups + DR + SLOs; KMS/HSM + key rotation; MFA + token introspection; metrics/tracing/alerting; transaction reversals + reconciliation + settlement lifecycle; independent CBOM ground truth; Bengali localization; threat-model and risk-register documents (the threat model is authored in this audit as `05_...`).

## 9. Recommended next steps (first five)

1. Fix the **replayable assertion** (add `jti`/nonce + server-side single-use cache). (P0, S)
2. Close the **audit atomicity gap** with a transactional outbox for ledger audit events. (P0, M)
3. Verify **Supabase token `aud`** and gate auto-provisioning. (P0, S)
4. Stand up **CI** running `test:all` + lint + `claim-audit` + dependency scanning + SBOM. (P0, M)
5. Commission an **independent human-prepared CBOM ground truth** so the F-experiment is publishable. (R, M)

Full dependency-ordered plan in `06_IMPLEMENTATION_ROADMAP.md`; tickets in `09_PRIORITIZED_BACKLOG.md`.

## 10. Readiness scorecard (verified-coverage = VERIFIED ÷ all applicable; BLOCKED/UNVERIFIED **included** in denominator)

| Dimension | Outcome | Verified coverage |
|---|---|---|
| A. Research | **RESEARCH VALIDATED** (1 caveat: CBOM ground-truth independence) | ~83% (15/18 R) |
| B. PQC migration capability | **RESEARCH VALIDATED** at prototype scope | ~75% of PQC |
| C. Application security | **PRE-PRODUCTION** | ~45% |
| D. Banking integration | **PRE-PRODUCTION** (reference core; reversals/reconciliation missing) | ~55% of FIN |
| E. Operational resilience | **PRODUCTION ASSURANCE REQUIRED** (little implemented) | ~10% |
| F. Production technical | **PRE-PRODUCTION** (not a technical candidate) | P0 technical gates unmet |
| G. Regulatory/organizational | **PRODUCTION ASSURANCE REQUIRED** | ~20% |

**Overall: RESEARCH VALIDATED / PRE-PRODUCTION.** The system demonstrates its scientific objective on this host; it is not suitable for real banking operations and does not claim to be. A high "verified coverage" in research dimensions does not override the P0 production blockers in §6 and `08`/`06`.
