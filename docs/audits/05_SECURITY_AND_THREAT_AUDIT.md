# Security and Threat Audit

The project ships a threat→requirement→mechanism→test matrix (`docs/TRACEABILITY.md`, T-01..T-06). This report extends it into a STRIDE analysis, PQC-specific threats, and a severity-ranked findings list. Severity reflects effect in a hypothetical real deployment, not spec silence.

## Threat model (trust boundaries from `04`)
Assets: customer balances & PII, banking audit chain, crypto policy & config, signing/HMAC keys, TLS session confidentiality, telemetry/evidence integrity. Actors: external peers (mTLS), customers, staff (operator/security_admin/auditor), the sidecar service identity, a network attacker on the private segment, a malicious/compromised DB superuser, the external Supabase project.

## STRIDE
| Category | Threat | Mitigation present | Residual |
|---|---|---|---|
| **Spoofing** | Fake peer / fake user / forged assertion | mTLS cert-fingerprint identity + deny-by-default; JWT w/ JWKS; HMAC assertion | Assertion replayable 30 s; Supabase `aud` unchecked; no MFA |
| **Tampering** | Modify payload / audit / config / telemetry | Hash-chained audit + DB immutability triggers; transactional config+audit; TLS transcript auth | Plain-HTTP internal hop (payload/telemetry tamperable); audit tip not anchored; superuser can disable triggers |
| **Repudiation** | Deny an action | Audit logs w/ actor+correlation; both chains verify | At-least-once audit can drop a posting's event |
| **Information disclosure** | Leak secrets / PII / crypto topology | pino redact + log-hygiene tests; CBOM key-file refusal; ownership checks; 404 opacity | At-rest unencrypted; CBOM topology readable by auditor; admin/status unauthenticated; Postgres no TLS |
| **Denial of service** | Exhaust resources | Rate limits (global/login/partner), maxConnections, body limits, bounded telemetry queue | In-memory limits (per-instance); no per-peer conn-rate limit; telemetry drop-oldest loses events |
| **Elevation of privilege** | Cross-role / cross-tenant / policy change | RBAC + SoD; ownership; `config:manage` admin-only; deny-by-default | Token honored until expiry (no introspection); no step-up; no MFA |

## PQC-specific threats
- **Harvest-now-decrypt-later (T-01):** mitigated on sidecar connections by hybrid KE; **classical fallback sessions have no PQ protection and are labelled as residual exposure** (correct, not hidden). Protection ends at the sidecar; the core hop and stored data are classical.
- **Downgrade/strip (T-03, C-05):** a stripped ClientHello is byte-indistinguishable from a classical client; the handshake fails via **transcript authentication**, not via the sidecar's detector. The detector's visibility limit is documented — do not claim MITM/downgrade-attack detection.
- **Classical authentication (T-06):** certificates (ECDSA P-256) and tokens (EdDSA/ES256) are classical; **PQ key establishment does not provide PQ authentication**. Correctly disclosed everywhere; PQ PKI is out of scope.
- **Provider/agility misuse:** only selectable, validated providers/profiles; unauthorized change prevented + audited.

## Fallback-policy risks
Deny-by-default for unknown peers; fallback requires explicit per-peer `classical-allowed`; every fallback is recorded as residual exposure. Risk is operational: a peer mis-registered as `classical-allowed` silently loses PQ protection — mitigated by telemetry/console visibility (ADV-003), but there is no aggregate "how many peers/paths are still classical" coverage metric (ADV-004).

## TLS authentication limitations
Single trust anchor (one CA), **no revocation (CRL/OCSP)** — a compromised peer cert is valid until expiry (`client-cert.ts:28`). `verifyError()` reaches into a private Node internal (`client-cert.ts:44`) — brittle across Node versions; falls back to manual X.509 checks if absent.

## Insider threats
Four roles with SoD; separate banking/security DBs; least privilege; append-only audit. Residual: a **DB superuser can disable the immutability triggers** (the verify step then reports the break, but prevention is not enforced at schema level); audit **tip truncation** is only detectable against an externally recorded head hash, which is not stored (OBS-003). CBOM documents (crypto topology, cert subjects/issuers/serials) are downloadable by any `auditor`/`security_admin` with no field-level redaction (CBOM-009).

## Key-management risks
No KMS/HSM. JWT Ed25519 key is a PEM on disk (or inline env, or ephemeral in dev); single `kid`, **no rotation/revocation**. Partner HMAC secret is a plain ≥32-char env string shared between sidecar and core (symmetric — either side can mint). A live secret currently sits in the working-tree `.env` (git-ignored, untracked, but unencrypted on disk). (SEC-008/009/010)

## Supply-chain risks
Lockfiles pin npm integrity hashes; CBOM scans an allow-list of crypto libs; evidence is checksummed and byte-pinned (`.gitattributes`). **Missing:** no dependency SBOM, **no vulnerability scanning (npm audit/Dependabot/Snyk/Trivy), no CI**, no package provenance/signature verification, no reproducible-build check. OpenSSL version is whatever the Node binary embeds. (T-05 partly covered; OPS-002/003/010)

## Banking-transaction abuse risks
Partners can only **credit** customer accounts (credit-only, settlement accounts invisible); per-peer idempotency + per-peer rate limit; amounts strictly positive, ≤15 digits; forged/replayed/other-path assertions refused. Residual: **reversals unimplemented** (no supported correction of an erroneous posting); **no reconciliation** to detect balance drift; at-least-once audit can leave a posting without its event.

---

## Findings, ranked by severity

| # | Severity | Finding | Location | Requirement |
|---|---|---|---|---|
| F1 | High | **Replayable partner assertion within 30 s** (no `jti`/nonce); shared HMAC secret also mints assertions | `pqc-sidecar/src/sidecar/assertion.ts:58-62`; `ledger-service/src/partner/assertion.ts` | API-005, SEC-002 |
| F2 | High | **At-least-once audit for money movements** — posting durable before its audit event; failure leaves an unaudited posting until client retry | `ledger-service/src/app/audit-service.ts:6-14`; `http/routes/transactions.ts`, `partner.ts` | FIN-010, OBS-003 |
| F3 | High | **Supabase token `aud` not verified + auto-provisioning** — any token from the project is accepted and auto-creates a customer | `ledger-service/src/adapters/supabase/verifier.ts:37-40`; `identity-service.ts:263-282` | IAM-002, DATA-012 |
| F4 | High | **No at-rest encryption, no KMS/HSM, single non-rotated signing key; HMAC secret plaintext on disk** | `ledger-service/src/compose.ts:28-37`; `.env` | SEC-007/008/009 |
| F5 | Medium | **Audit tip not externally anchored; superuser can disable immutability triggers** | `*/migrations/*` triggers; `audit-service.ts:29-30` | OBS-003 |
| F6 | Medium | **No cert revocation; single CA; `verifyError` uses a private Node internal** | `pqc-sidecar/src/sidecar/client-cert.ts:28,44` | PQC-012 |
| F7 | Medium | **Unauthenticated admin/status endpoints** (loopback-only) expose config/telemetry internals | `pqc-sidecar/src/main.ts:68-74` | SEC-004/012 |
| F8 | Medium | **In-memory rate limits/counters** reset per instance; no per-peer connection-rate limit; telemetry drop-oldest = event loss | `ledger-service/src/http/server.ts:64-69`; `pqc-sidecar/src/sidecar/control-plane.ts:135-139` | SEC-011, PERF-008/009 |
| F9 | Medium | **No CI, no dependency scanning/SBOM** — supply-chain and regression risk unmanaged | repo-wide (no `.github/`) | OPS-002/003/010 |
| F10 | Medium | **Reversals unimplemented; no reconciliation** — no supported correction path; balance drift undetected | `ledger-service/src/domain/ledger.ts:57`; no reconciliation job | FIN-006/008/012 |
| F11 | Medium | **Plain-HTTP internal hops + Postgres without TLS** — payload/telemetry readable/forgeable on the segment | `04` boundaries 2–4 | SEC-001/002 |
| F12 | Low | **CBOM topology (cert subjects/issuers/serials) readable by auditor; no field redaction** | `security-service/src/http/routes/cbom-routes.ts:81-88` | CBOM-009 |
| F13 | Low | **No enforced OpenSSL/Node floor** — too-old runtime silently rejects config / never ready | `pqc-sidecar/src/main.ts`, `src/sidecar/server.ts:143-148` | PQC-018 |
| F14 | Low | **No MFA / step-up; token honored until expiry** (security-service has no introspection) | `security-service/src/auth/verifier.ts:14-18` | IAM-001/008/009 |
| F15 | Informational | **CBOM ground truth AI-prepared by the same agent** — research-validity, not a live security hole | `security-service/ground-truth/cbom-ground-truth.json:4` | RES-010/CBOM-005 |

> None of the High findings is a *silent* crypto failure: the system fails closed on crypto (unknown group/peer → reject) and labels classical exposure. The High findings are integrity/identity/key-management gaps that matter the moment this moves beyond a single-host prototype.
