# Project status, decisions and limitations

Living record for the *Hybrid Post-Quantum Migration Architecture for Legacy-Style Digital Banking*
research prototype (proposal dated 30 September 2026). Source of truth for what is implemented
versus simulated versus planned. Update it in the same commit as the change it describes.

Status vocabulary (proposal Appendix B): **LIVE** = implemented and covered by a test or captured
evidence in this repository. **SIM** = deliberately simulated/educational. **PLANNED** = not built.
Nothing here is a claim of production readiness, regulatory compliance, certification, or
complete quantum resistance.

## 1. Architecture (target)

```
 simulated peers (peer-simulator, holds its own CA/peer keys)
        |  TLS 1.3, mutual TLS, X25519MLKEM768 or X25519
        v
 pqc-sidecar  --- config pull / event push --->  security-service  <--- JWT (JWKS) ---  dashboard (moneypurse-web)
        |                                          (peers, TLS profiles, provider registry,        |
        |  plain HTTP on private net,               config versions, telemetry, CBOM, HNDL,        |
        |  HMAC-signed peer assertion               benchmarks, status, config audit)              |
        v                                                                                          |
 ledger-service (core: accounts, ledger, identity/RBAC, audit)  <------------- JWT --------------------+
        |
   PostgreSQL (databases: ledger, security)
```

Scope boundaries inherited from the proposal: certificates stay classical (no ML-DSA/PQ PKI);
the sidecar protects only traffic routed through it; the sidecar-to-core hop is plain HTTP on a
private network; no HSM, no formal verification, no side-channel analysis; the HNDL simulator is
didactic and performs no cryptanalysis.

## 2. Implementation status matrix

| Component | Status | Evidence / note |
|---|---|---|
| Double-entry ledger core (accounts, transfers, idempotency, Postgres + memory adapters) | LIVE | `ledger-service/tests/**`, DB balance trigger in `migrations/0001_init.sql` |
| Dashboard: accounts, transactions, cash-flow, spending (real ledger data, signed-in customer, TLS provenance badges on partner payments) | LIVE | `moneypurse-web/tests/**` (127 tests); verified in the browser |
| Dashboard: savings pots, card controls, search suggestions | SIM | static fixtures, no backend; to be labelled SIM in the UI |
| Authentication (scrypt, EdDSA JWT + JWKS, refresh rotation with reuse detection, lockout), RBAC (4 roles), ownership checks, forced password change | LIVE | `ledger-service/tests/http/{auth,rbac,api}.test.ts`, `tests/identity/crypto.test.ts` |
| Tamper-evident audit log (hash chain, DB-level append-only, verify endpoint) | LIVE | `tests/audit/chain.test.ts`, `tests/adapters/postgres-identity-audit.integration.test.ts` |
| security-service: peer registry, provider/TLS-profile registry, versioned audited configuration, telemetry ingestion + queries, alert acknowledgement, config audit chain, implementation-status API | LIVE | `security-service/tests/{peers,config,telemetry,audit,access,status}.test.ts` (70 tests, real PostgreSQL) |
| Hybrid TLS 1.3 sidecar (`X25519MLKEM768`), mutual TLS, verified negotiated group, signed peer assertion to the core | LIVE | `pqc-sidecar/tests/{wire,sidecar}.test.ts` (91 tests, real TLS handshakes) |
| Per-peer fallback policy + violation telemetry (experiments B and C scenarios) | LIVE | `pqc-sidecar/tests/{policy,scenarios}.test.ts`; live run recorded in section 9 |
| Simulated external peers + controlled ClientHello-modification proxy | SIM | `pqc-sidecar/tests/scenarios.test.ts` |
| Core partner API: sidecar-asserted inbound payments recording the verified TLS key exchange on each ledger transaction | LIVE | `ledger-service/tests/http/partner.test.ts`, `pqc-sidecar/tests/scenarios.test.ts`; live run in section 10 |
| CryptoProvider registry + configuration switching (sidecar polls and applies to new connections; time-to-apply recorded) | LIVE | `security-service/tests/config.test.ts`, `pqc-sidecar/tests/sidecar.test.ts`, e2e section 5 |
| CBOM generator (CycloneDX 1.7) + schema validation + ground-truth comparison | LIVE | `security-service/tests/cbom.test.ts` (42 tests); numbers in section 11 |
| HNDL educational simulator + Mosca calculator | SIM | `security-service/tests/{hndl,research}.test.ts`; real primitives, modelled adversary, no cryptanalysis |
| Benchmark harness + environment manifest; immutable evidence ingestion | LIVE | `pqc-sidecar/tests/bench.test.ts`, `security-service/tests/research.test.ts`; results in section 11 |
| Supabase add-on identity layer: dual-step email-OTP customer sign-up, local customer provisioning, core accepts Supabase ES256 tokens (JWKS) alongside local tokens | LIVE (code) | `ledger-service/tests/{identity/supabase-verifier,app/identity-supabase,http/supabase-auth}.test.ts`; `moneypurse-web/tests/lib/auth/*`, `components/auth/SignupForm.test.tsx`. End-to-end OTP email delivery is a manual/demo check (external service), not in CI; tokens are classical ES256 |
| ML-DSA / PQ certificates / JWT migration | PLANNED (out of scope) | proposal section 21 |

## 3. Decisions

- **D-01 Stack: stay on Node 26 / TypeScript / Fastify / PostgreSQL.** The proposal names
  Spring Boot + Bouncy Castle/BCJSSE as *planned implementation choices* (section 5) and says
  support must be confirmed during setup. Existing code is Node; switching would discard working
  code with no research benefit. Revisit only if the TLS stack cannot do the job (it can, D-02).
- **D-02 TLS stack: Node `tls` on OpenSSL 3.5.7.** Probe (2026-11-01): server `ecdhCurve`
  `X25519MLKEM768:X25519` negotiates the hybrid group with a hybrid client and X25519 with a
  classical client; a hybrid-only server rejects a classical-only client (alert 40) and vice versa.
  Wire capture shows ServerHello `key_share` group `0x11ec` with a 1120-byte share (RFC 10024
  value) for hybrid, `0x001d` / 32 bytes for X25519.
- **D-03 Observing the negotiated group.** Node does not expose it reliably: the client
  `getEphemeralKeyInfo()` returns `{}` for the hybrid group and the server side returns `null`.
  The sidecar therefore parses the unencrypted ClientHello/ServerHello on the wire ("verified
  handshake trace", which the proposal allows in section 8.1). Limitation stated in the UI.
- **D-04 Peer identity = mutual-TLS client certificate fingerprint** (SHA-256), registered in the
  peer registry. Network address is never used as identity (proposal 8.2). Unknown or
  unregistered certificates are denied by default.
- **D-05 Identity provider lives in ledger-service** (module `src/identity`), issuing EdDSA JWTs
  verified by other services through JWKS. Avoids a fourth service for the prototype.
- **D-06 Separate PostgreSQL databases** `ledger` and `security` on one server (isolation of
  event metadata from banking data, proposal T-04).
- **D-07 Audit integrity: hash-chained append-only audit tables** with a verification endpoint;
  UPDATE/DELETE blocked by trigger.
- **D-08 Service-to-service auth:** static high-entropy bearer tokens from environment for
  `/internal/*` APIs; the core accepts partner traffic only with an HMAC-signed assertion from
  the sidecar (peer, group, correlation id, timestamp).
- **D-09 CORS:** explicit allow-list only. The earlier reflect-any-origin default is removed now
  that credentials exist.

## 4. Assumptions

- Single-host research environment (Docker Compose Postgres + Node processes); loopback timing
  is not representative of banking networks.
- Simulated peers and the test CA are generated locally; their private keys never enter
  security-service or the repository.
- Roles: `customer`, `operator`, `security_admin`, `auditor`.

## 5. Known limitations (carried into the UI and claim ledger)

- Classical fallback sessions have no post-quantum key-establishment protection.
- The sidecar cannot prove an on-path attacker stripped a ClientHello; it detects policy
  violations visible to it (expected profile vs observed group).
- Configuration switching applies to new connections; per-operation provider substitution is
  not implemented and not claimed.
- Hybrid key establishment does not make the banking system quantum-resistant.

## 6. Stage log

| Stage | Scope | State |
|---|---|---|
| 0 | Audit, feasibility probes, plan | done 2026-11-01 |
| 1 | ledger-service identity, RBAC, audit, hardening | done 2026-11-01 - 127 tests green incl. Postgres integration; live smoke test passed |
| 2 | security-service | done 2026-11-01 - 70 tests green on real PostgreSQL; live cross-service auth smoke test passed |
| 3 | pqc-sidecar + peer simulator | done 2026-11-01 - 91 sidecar tests; 7 scenarios pass on the live stack |
| 4 | partner API integration | done 2026-11-01 - 131 ledger + 94 sidecar tests; live end-to-end payment verified |
| 5 | CBOM, HNDL simulator, benchmark | done 2026-11-01 - 142 security-service tests; CBOM, HNDL, benchmark ingestion live (section 11) |
| 6 | frontend auth + security console | done 2026-11-01 - auth gate, console pages, provenance badges, CBOM / HNDL / benchmarks / experiments pages; 166 web tests; research pages checked against live API responses, **not yet viewed in a browser** |
| 7 | e2e validation, evidence, docs | done 2026-11-01 - e2e 50/50 (`evidence/e2e/`), clean benchmark run, claim ledger, traceability, runbook |
| 8 | Supabase add-on identity + dual-step OTP sign-up | done 2026-11-01 - ledger 150 + web 209 tests green; spec `docs/superpowers/specs/2026-11-01-supabase-otp-auth-design.md`; design decisions in section 3; hosted OTP email round trip verified manually, not in CI |

## 7. Stage 1 findings (security defects in the pre-existing backend, now fixed)

- No authentication or authorization on any route: anyone could create accounts, post arbitrary
  journal entries and read any account.
- A negative transfer amount reversed the transfer direction (would let a caller pull money out of
  any account). Amounts are now strictly positive, max 15 digits (test: `rejects zero and negative transfer amounts`).
- Oversized amount strings reached Postgres and produced a 500 instead of a 400.
- Idempotency keys were global across callers; they are now scoped per authenticated user.
- Client-supplied transaction metadata could have been mistaken for provenance; server-attested
  `context` is stored separately and the key is reserved.
- CORS reflected any origin; it is now an explicit allow-list (credentials are in use).
- Integration tests truncated the application's database; they now use an isolated `ledger_test` database.

Known Stage 1 limitations: audit append is a separate DB transaction from the ledger posting
(at-least-once audit, documented in `audit-service.ts`); tail truncation of the audit chain is only
detectable against an externally recorded head hash; rate-limit counters are in-memory
(single-instance).

## 8. Stage 2 notes

- Provider registry marks the Bouncy Castle (BCJSSE) provider PLANNED and non-selectable; only the
  Node.js TLS (OpenSSL) provider can be configured. Profiles may only reference registered groups.
- Every configuration change appends a config version and a hash-chained audit entry in ONE
  database transaction (tested: a rejected duplicate leaves neither behind).
- Severity of a telemetry event is derived server-side from the decision; a reporter cannot set it.
- Experiment E support: `GET /v1/crypto/config` reports, per configuration version, how long until
  a running sidecar reported it applied (`timeToApplyMs`). The sidecar populates this in Stage 3.
- security-service tests need PostgreSQL (they use an isolated `security_test` database).

## 9. Stage 3 findings and measurements

Verified on this machine (Node v26.4.0, OpenSSL 3.5.7, loopback, single host - not a production network):

- **The Node TLS API cannot report a hybrid negotiated group** (client `getEphemeralKeyInfo()` returns an empty
  object, server side returns null). The sidecar therefore parses the plaintext ClientHello/ServerHello (decision
  D-03); this is the "verified handshake trace" the proposal allows.
- **H1 (handshake bytes), first observation:** ClientHello record 1457 B with the hybrid share vs 235 B classical;
  hybrid server key share 1120 B vs 32 B (client share 1216 B vs 32 B) - the RFC 10024 sizes, asserted in
  `pqc-sidecar/tests/wire.test.ts`. Single handshakes only; the benchmark harness (Stage 5) produces the distribution.
- **OpenSSL sends only the first group's key share** unless the group list uses the `*` prefix
  (`*X25519MLKEM768:*X25519`). Browser-like peers need the prefix; without it a hybrid-first client offers a
  classical group in supported_groups but no classical share.
- **A manually constructed server TLSSocket never sets `socket.authorized`** (only `tls.Server` does). The first
  implementation therefore rejected every peer (fail-closed). Client certificates are now verified explicitly
  (OpenSSL verdict where exposed + independent X.509 checks); see `src/sidecar/client-cert.ts`.
- **Experiment C (controlled ClientHello modification):** stripping X25519MLKEM768 from a hybrid peer's hello makes the
  handshake FAIL (transcript mismatch in Finished); it never silently completes on X25519. The sidecar sees only
  the modified hello (classical groups only), which is indistinguishable from a legitimate classical-only client -
  so the detector scope stays "policy violations visible to the sidecar", exactly as the proposal states. The
  failure happens before the client authenticates, so the event has no peer identity.
- **H3:** every connection that completes a handshake ends in exactly one classified decision; a classical
  negotiation is either `allowed-fallback` (classical-allowed peer) or rejected.
- **Experiment E (partial):** configuration changes apply to new connections without a restart (tested at the
  sidecar and visible live as the sidecar picking up registry changes while running). Measured time-to-apply is
  reported by `GET /v1/crypto/config`; a recorded distribution comes with the Stage 7 evidence package.

Live run of all seven scenarios through dashboard API -> simulator -> sidecar -> telemetry (2026-11-01): all PASS,
sidecar in sync, OpenSSL 3.5.7 reported by the running sidecar.

## 10. Stage 4: end-to-end integration

Flow: simulated peer --(TLS 1.3, mutual TLS)--> pqc-sidecar --(plain HTTP + HMAC-signed assertion)--> ledger-service
`/partner/v1/*` --> double-entry posting from the partner settlement account to a customer account.

- The core trusts a peer identity or negotiated group **only** through the sidecar's signed assertion (peer, verified
  key exchange, decision, correlation id, timestamp, bound to method + path, 30 s window). A forged or replayed
  assertion, an assertion for another path, and an assertion for a rejected connection are all refused (tests).
- Partners can only *credit* customer accounts (strictly positive amounts); bank-internal settlement accounts look
  non-existent to them; idempotency keys are scoped per peer; rate limits are per peer.
- Each posting stores `context = {channel: "partner", peer, tls: {keyExchange, negotiatedGroup, decision}}` in the
  same database transaction as the postings, and an audit entry (actor role `partner`) carries the sidecar's
  correlation id, so a customer-visible transaction can be traced to the exact TLS connection record.
- Live run (2026-11-01): hybrid peer payment -> context `hybrid / X25519MLKEM768`; classical-only peer payment ->
  `allowed-fallback / classical / X25519`; customer balance +15000; direct call to the core with a forged assertion -> 401.
- Known limit (by design, proposal section 9): post-quantum protection ends at the sidecar. The sidecar-to-core hop is plain HTTP
  authenticated by an HMAC, and a caller that can reach the core's port directly can still use the JWT-protected
  user API; network isolation of the core is a deployment control this prototype does not provide.

## 11. Stage 5: CBOM, HNDL simulator, benchmark

**CBOM (H4, Appendix E method).** CycloneDX 1.7 documents are generated from a hand-maintained usage register
(tokens re-checked in the named files), public certificate files (a file that looks like a key is never opened), an
allow-listed dependency scan and observed handshake telemetry, then validated against the vendored official schema
(hashes in `security-service/schemas/cyclonedx-1.7/MANIFEST.md`) and compared with a versioned, scoped manual ground
truth (30 items). Run against the live system: 24 assets generated, TP 24 / FP 0 / FN 6, completeness 0.80,
precision 1.00. Precision is structurally easy here (the generator only emits what its sources give it), so
completeness and the location recall (33 of 84 locations, 0.39) are the informative figures. Misses are items the register
does not list (simulated peer keys, service tokens, scrypt hashes, audit digests) plus the HKDF used by the HNDL
simulator. **The ground truth was prepared by an AI assistant that also wrote the generator; a human reviewer must
confirm it before any research claim.**

**HNDL simulator (SIM).** Real X25519, ML-KEM-768, HKDF-SHA256 and AES-256-GCM on throw-away keys; the adversary is a
user-chosen assumption (`none`, `x25519-broken`, `both-broken`), not an attack. Result: under an X25519 break the
classical capture opens and the hybrid capture stays closed (AES-GCM authentication fails because the ML-KEM secret
is missing); under `both-broken` the hybrid opens too. Wire sizes are the real ones (32/32 B classical, 1216/1120 B
hybrid). A Mosca X+Y>Z calculator labels years-to-quantum as the user's assumption.

**Benchmark (Experiments A and G).** Standard preset: 30 runs x 300 handshakes per condition, interleaved, separate
server process, no resumption, loopback, i5-12500H, Node 26.4.0, OpenSSL 3.5.7, 18,000 handshakes with 0 failures.
Evidence: `evidence/bench/2026-10-31T20-49-52-048Z-standard/` (raw CSV, manifest, checksums), also stored immutably
in the security-service.

| | classical X25519 | hybrid X25519MLKEM768 |
|---|---|---|
| median handshake | 1.84 ms | 2.14 ms |
| p95 / p99 | 2.93 / 3.96 ms | 3.29 / 4.62 ms |
| ClientHello / ServerHello record | 235 / 127 B | 1411 / 1215 B |
| wire bytes sent / received | 235 / 831 | 1411 / 1909 |

H1: hybrid adds 1176 B (ClientHello) and 1088 B (ServerHello). H2: paired per-run median difference +0.265 ms (95%
bootstrap CI over 30 runs: 0.153 to 0.384 ms), verdict hybrid-slower, i.e. a real but small cost on this host.
Throughput 380-510 handshakes/s at concurrency 1-16 with hybrid 5-16% below classical; CPU figures are coarse on
Windows. Absolute latency drifts between runs on this laptop (an earlier invalid run showed 1.3 ms medians, this one
1.8 ms), which is why only paired within-run differences are reported. These numbers support no capacity or
production-latency claim. The manifest says "dirty working tree" because the harness fix below was committed right
after the run.

**Two invalid runs, kept and explained** (`evidence/bench/invalid/README.md`): the harness first exhausted the
Windows ephemeral port range (fixed with 32 listener ports) and then lost handshakes to client-side TIME_WAIT
(fixed by letting the server close first). A validity gate (failure rate over 0.5% or any throughput failure) now
refuses to publish such runs, and the security-service derives an integrity status from a run's own failure counts, so
the one invalid run that had been published is flagged `invalid` instead of being edited.

**Not covered / next:** HKDF and the benchmark/simulator tokens are not yet in the CBOM register; cross-machine
benchmark runs; Experiment D (HNDL on real captures) is out of scope.

## 12. Final verification (2026-11-01)

Suites: ledger 132, security 144, sidecar 113, web 166 - 555 tests, all passing. Live stack e2e: 50/50 (latest
`evidence/e2e/2026-11-01T00-24-56-403Z/`). `node scripts/claim-audit.mjs`: 7 occurrences of restricted phrases, all negations.

Known gaps carried forward:
- The four research pages were verified by component tests and by feeding live API responses through their formatters
  (the sandbox did not allow reading staff credentials for a scripted browser login); they have not been looked at in a
  browser as a staff user. Customer-side pages were verified live in the browser, including the role redirect.
- `npm run lint` in `moneypurse-web` fails with 393 errors in files that predate this work (dashboard hook, chart,
  existing tests, compiled `dist-tests`); type-check and production build pass.
- The CBOM ground truth was prepared by an AI assistant and needs independent human review; HKDF and the benchmark and
  simulator service tokens are missing from the usage register.
- Benchmarks are one laptop on loopback; cross-machine runs and Experiment D are not done.
- The sidecar-to-core hop is plain HTTP with an HMAC-signed assertion; certificates and JWTs are classical.
- Backend follow-ups noted by the frontend work: include the ground-truth scope and preparer in the comparison response;
  publish the permission set instead of mirroring it in the UI.

## 13. NFR remediation (post-audit, 2026-11-02)

Driven by the audit in `docs/audits/`. Each milestone was built test-first on its own branch, verified
(`npm run test:all` + per-service type-check + `scripts/claim-audit.mjs`), and merged to `main`. The staged plan
for the remaining work (M4 KMS/at-rest, M7 HA/DR, M8 internal mTLS/PKI, M9 independent CBOM validation), with every
task classified LOCAL / INFRA / HUMAN, is `docs/audits/11_STAGED_PLAN_M4_M9.md`.

| Milestone | Change | Audit finding | Status | Evidence |
|---|---|---|---|---|
| M0 | Single integration line + CI gate (test:all, type-check, lint, claim-audit, dep scan, CycloneDX SBOM) | OPS-002/003/010 | VERIFIED (CI runs on push once a GitHub remote exists) | `.github/workflows/ci.yml` |
| M1 | Replay-proof partner assertion: `v:2` + unique `jti` + single-use `AssertionReplayCache` | F1 / API-005 | VERIFIED | `pqc-sidecar/src/sidecar/assertion.ts`, `ledger-service/src/partner/replay-cache.ts`, `tests/.../replay-cache`, `http/partner.test.ts` |
| M3 | Supabase token `aud` verified; auto-provisioning gated behind `SUPABASE_AUTO_PROVISION` (default off), refusal audited | F3 / IAM-002 / DATA-012 | VERIFIED | `ledger-service/src/adapters/supabase/verifier.ts`, `app/identity-service.ts`, `tests/identity/supabase-verifier`, `app/identity-supabase` |
| M2 | Financial postings audited INSIDE the posting transaction (atomic, exactly-once); no at-least-once gap | F2 / FIN-010 / OBS-003 | VERIFIED | `ledger-service/src/adapters/postgres/{audit-append,ledger-store}.ts`, `tests/app/ledger-audit-atomicity`, postgres integration |
| M5 | Transaction reversals (compensating entries, original marked reversed, operator-gated) + `reconcileBalances` drift sweep | FIN-006/008/012 | VERIFIED (reconcile scheduling pending) | `ledger-service/src/.../ledger-store.ts`, `http/routes/transactions.ts`, `tests/http/reversal`, `app/reconcile`, postgres integration |
| M6 | `/livez` + `/readyz` + Prometheus `/metrics` across ledger, security, sidecar | REL-006 / OBS-005 | VERIFIED (tracing + alerting still open) | `ledger-service/src/http/server.ts`, `security-service/src/http/server.ts`, `pqc-sidecar/src/admin.ts`, `tests/.../observability`, `admin.test.ts` |
| M4 (slice) | JWT signing-key rotation via a multi-key JWKS (active key + retained previous keys) | SEC-008 (part) | PARTIAL — rotation VERIFIED; KMS/HSM + at-rest encryption (SEC-007/009) still require external infra | `ledger-service/src/identity/tokens.ts`, `tests/identity/key-rotation.test.ts` |

Test counts on `main` after these milestones (with PostgreSQL running): ledger 196, security 144, sidecar 117, web 210.
`scripts/claim-audit.mjs` remains clean (0 un-negated restricted phrases). The flaky `pqc-sidecar` benchmark-throughput
test can fail under full-suite CPU contention; it passes on an isolated run and is unrelated to these changes.

Carried-forward limitations unchanged by this work: no real KMS/HSM or at-rest volume encryption (M4.e); no production
HA/DR, containers or IaC in operation (M7, local slices planned); sidecar→core hop still plain HTTP + HMAC until M8
internal mTLS lands; the CBOM ground truth still awaits an independent human reviewer (M9.c). Hybrid PQ protection
remains key-establishment-only at the external sidecar boundary; certificates and token signatures are classical.

### Stage 10: M4–M9 (post-audit, 2026-11-02) — local slices delivered; infra/human parts bounded

Staged plan: `docs/audits/11_STAGED_PLAN_M4_M9.md` (every task classified LOCAL / INFRA / HUMAN).

| Milestone | Change | Status | Evidence |
|---|---|---|---|
| M4 KMS | `KeyManagementService` port + local `DevKms` (AES-256-GCM envelope, versioned master keys); `customers.full_name` envelope-encrypted at rest in Postgres; fails closed on tamper/wrong-key/KMS-down | SEC-008 VERIFIED; SEC-007/009 PARTIAL (app-level done; **volume TDE + real HSM are INFRA**) | `ledger-service/src/crypto/kms.ts`, `tests/crypto/kms.test.ts`, `tests/adapters/postgres-identity-kms.integration.test.ts` |
| M8 internal mTLS | dev PKI (internal CA → ECDSA server/client certs) + TLS 1.3 mutual-TLS transport + revocation deny-list | SEC-001/002, PQC-012 PARTIAL (transport VERIFIED; **live hop-2 wiring, edge/DB TLS, OCSP are INFRA**) | `pqc-sidecar/src/internal-mtls.ts`, `tests/internal-mtls.test.ts`, `docs/audits/12_HOP_PROTECTION.md` |
| M7 HA/DR | verified logical backup/restore (`scripts/db-backup.mjs`/`db-restore.mjs`); Dockerfiles + deploy compose + local HA-Postgres compose (artifacts) | REL-008/002/007, OPS-007/011 PARTIAL (**replication/failover/PITR/offsite/k8s are INFRA**) | `scripts/db-*.mjs`, `*/Dockerfile`, `deploy/**`, `docs/audits/13_HA_DR.md` |
| M9 CBOM validation | independent ground-truth template + sourcing guide + reproducible review procedure; diff tooling already exists | CBOM-005/RES-010 PARTIAL — **final human sign-off PENDING by design (not fabricated)** | `security-service/ground-truth/cbom-ground-truth.template.json`, `docs/audits/14_CBOM_GROUND_TRUTH.md` |

Test counts on `main` after Stage 10 (PostgreSQL running): ledger 206, security 144, sidecar 121, web 210; claim-audit clean.
Outstanding = external infrastructure (cloud KMS/HSM, at-rest volume encryption, HA replication/failover, PITR, offsite
immutable backups, k8s/Helm, edge/DB TLS, OCSP responder) and one independent human (the CBOM sign-off). Every such item
is labelled INFRA or HUMAN in the plan and NOT claimed done.
