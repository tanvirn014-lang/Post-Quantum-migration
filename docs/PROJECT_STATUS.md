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
| Dashboard: accounts, transactions, cash-flow, spending (real ledger data) | LIVE data path, **currently unauthenticated and broken against the secured API** until Stage 6 | `moneypurse-web/tests/**` |
| Dashboard: savings pots, card controls, search suggestions | SIM | static fixtures, no backend; to be labelled SIM in the UI |
| Authentication (scrypt, EdDSA JWT + JWKS, refresh rotation with reuse detection, lockout), RBAC (4 roles), ownership checks, forced password change | LIVE | `ledger-service/tests/http/{auth,rbac,api}.test.ts`, `tests/identity/crypto.test.ts` |
| Tamper-evident audit log (hash chain, DB-level append-only, verify endpoint) | LIVE | `tests/audit/chain.test.ts`, `tests/adapters/postgres-identity-audit.integration.test.ts` |
| security-service (peer registry, profiles, telemetry, config audit) | PLANNED | Stage 2 |
| Hybrid TLS 1.3 sidecar (`X25519MLKEM768`) | PLANNED | Stage 3; feasibility probe passed (see D-02) |
| Per-peer fallback policy + violation telemetry | PLANNED | Stage 3 |
| CryptoProvider registry + configuration switching | PLANNED | Stages 2-3 |
| CBOM generator + schema validation + ground-truth comparison | PLANNED | Stage 5 |
| HNDL educational simulator | PLANNED (will be SIM) | Stage 5 |
| Benchmark harness + environment manifest | PLANNED | Stage 5 |
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
| 2 | security-service | not started |
| 3 | pqc-sidecar + peer simulator | not started |
| 4 | partner API integration | not started |
| 5 | CBOM, HNDL simulator, benchmark | not started |
| 6 | frontend auth + security console | not started |
| 7 | e2e validation, evidence, docs | not started |

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
