# Claim ledger (proposal Appendix F)

Every statement this prototype makes about itself, with the label the proposal requires and the evidence behind it.
Labels: **IMPLEMENTED** (present and tested in this repository), **SIMULATION** (model or toy data, never a real attack),
**MEASURED** (raw data and configuration attached), **HYPOTHESIS RESULT** (outcome of a stated hypothesis on this host),
**FUTURE** (not built). Evidence paths are relative to the repository root.

Re-check mechanically: `node scripts/claim-audit.mjs` (restricted phrases), `node scripts/e2e.mjs` (live stack),
and the status registry test (`security-service/tests/status.test.ts`) which fails if a LIVE/SIM component cites evidence that does not exist.

## 1. Claims the prototype makes

| # | Claim | Label | Evidence | Limits stated next to the claim |
|---|---|---|---|---|
| C-01 | The sidecar negotiates TLS 1.3 key agreement `X25519MLKEM768` (code point 0x11ec, 1216 B client / 1120 B server share) with hybrid-capable peers and X25519 with classical-only peers | IMPLEMENTED | `pqc-sidecar/tests/{wire,sidecar,scenarios}.test.ts`; e2e section 3 (server share 1120 B / 32 B) | Node.js / OpenSSL 3.5.7, not the Java/BCJSSE stack named in the proposal |
| C-02 | The negotiated group is verified from the ServerHello on the wire, not assumed | IMPLEMENTED | `pqc-sidecar/tests/wire.test.ts` | `node:tls` cannot report a hybrid group itself, so this is a "verified handshake trace" |
| C-03 | Peer identity is the mutual-TLS client-certificate fingerprint; unknown or untrusted certificates are denied | IMPLEMENTED | `pqc-sidecar/tests/{sidecar,scenarios}.test.ts`; e2e scenarios `unregistered-peer`, `untrusted-certificate`, `no-client-certificate` | Single trusted test CA, no revocation checking |
| C-04 | Each connection ends in exactly one classified decision; classical negotiation is either an explicitly permitted, labelled fallback or a rejected violation | IMPLEMENTED | `pqc-sidecar/tests/policy.test.ts`; e2e section 6 (all five decisions observed) | Detects violations visible to the sidecar only |
| C-05 | A ClientHello with the hybrid group stripped on the path is indistinguishable, server-side, from a legitimate classical client; the handshake fails because the transcript no longer matches | IMPLEMENTED (measured behaviour) | scenario `clienthello-downgrade-tamper` in `pqc-sidecar/tests/scenarios.test.ts` and e2e | This is why the detector is described as "policy-violation detection with stated visibility limits", never as downgrade-attack detection |
| C-06 | A TLS profile change reaches the sidecar and applies to new connections without a restart, and is audited | IMPLEMENTED; H5 result below | `security-service/tests/config.test.ts`, `pqc-sidecar/tests/sidecar.test.ts`, e2e section 5 | Existing connections keep what they negotiated; selection is configuration-level, not per-operation provider substitution; one selectable provider |
| C-07 | Partner payments are accepted only with a signed sidecar assertion, and the ledger stores the verified key exchange with the transaction | IMPLEMENTED | `ledger-service/tests/http/partner.test.ts`; e2e section 4 | Sidecar-to-core hop is plain HTTP on a private network; PQ protection ends at the sidecar |
| C-08 | Authentication, role-based access, ownership checks, lockout, refresh rotation with reuse detection | IMPLEMENTED | `ledger-service/tests/http/{auth,rbac,api}.test.ts`; `security-service/tests/access.test.ts`; e2e section 2 | JWT and certificate signatures are classical (EdDSA, ECDSA); access tokens are honoured by the security service until expiry |
| C-09 | Banking and configuration audit logs are append-only, hash-chained and verifiable | IMPLEMENTED | `ledger-service/tests/audit/chain.test.ts`, `security-service/tests/audit.test.ts`; e2e section 7 | Truncating the newest events is only detectable against an externally recorded head hash; not a WORM store |
| C-10 | Credentials, tokens, service secrets and request payloads do not appear in application logs | IMPLEMENTED | `ledger-service/tests/http/log-hygiene.test.ts`, `security-service/tests/log-hygiene.test.ts` (mutation-checked) | Covers the paths exercised by the tests, not every possible log line |
| C-11 | Money is stored as integer minor units; every transaction posts balanced entries; all balances sum to zero | IMPLEMENTED | `ledger-service/tests/domain/*.test.ts`, Postgres integration tests, e2e section 4 | A minimal Fineract-like reference core, not a real bank core |
| C-12 | A CycloneDX 1.7 CBOM is generated, validates against the official schema, and is compared with a scoped manual ground truth | IMPLEMENTED | `security-service/tests/cbom.test.ts`; e2e section 8; numbers in `PROJECT_STATUS.md` section 11 | Not complete cryptographic discovery; ground truth prepared by an AI assistant and awaiting human review |
| C-13 | The HNDL simulator shows that a recorded classical X25519 session opens if its secret is assumed recoverable while a hybrid session does not unless ML-KEM is also assumed broken | SIMULATION | `security-service/tests/hndl.test.ts` | Real primitives, modelled adversary; no quantum computation, no cryptanalysis of any real key, no prediction |
| C-14 | Hybrid adds 1176 B to the ClientHello record and 1088 B to the ServerHello record versus X25519 | MEASURED / H1 | `evidence/bench/2026-10-31T20-49-52-048Z-standard/` | Loopback capture of this implementation |
| C-15 | Hybrid handshakes take about 0.27 ms longer than X25519 (95% CI 0.15 to 0.38 ms over 30 runs) | MEASURED / H2 | same directory | Single laptop, loopback, no network; no capacity or production-latency claim |

## 2. Hypotheses (proposal section 13): outcome on this host

| H | Result | Basis |
|---|---|---|
| H1 extra handshake bytes | **Supported.** +1176 B / +1088 B in the hello records; key shares of exactly 1216 B / 1120 B observed on the wire | benchmark evidence; e2e |
| H2 extra computation | **Supported, small.** Paired per-run median difference +0.265 ms, CI excludes zero | benchmark evidence; two earlier invalid runs are archived and excluded (`evidence/bench/invalid/`) |
| H3 every classical negotiation is classified | **Not refuted.** No unclassified classical connection in the test or live runs | policy tests; e2e section 6 |
| H4 CBOM captures the assets in its declared scope | **Partly supported.** Completeness 0.80, precision 1.00, 6 false negatives | `PROJECT_STATUS.md` section 11; the gap is quantified, as the hypothesis requires |
| H5 profile change takes effect without restart and is audited | **Supported.** Applied to new connections in 3.9 to 4.9 s (poll-interval bound), each change in the audit log with the actor | e2e section 5 |
| H6 simulator contrasts supplied-secret classical capture with hybrid | **Illustrated.** Demonstrates simulator logic only | `hndl.test.ts` |

## 3. Claims the prototype does **not** make

- Not quantum-resistant as a system: only key establishment on the sidecar's connections is hybrid; certificates, JWTs and stored data are classical.
- Not a defence against, or a demonstration of, a real quantum attack; the HNDL simulator is educational.
- Not complete cryptographic discovery of a bank; the CBOM covers a declared register, public certificate files, a dependency scan and observed telemetry.
- No production readiness, banking compliance or capacity claim; benchmarks are single-host loopback.
- No novelty or "first" claim; a literature review has not been done.
- Fallback sessions are classical exposure and are labelled as such wherever they are shown.

## 4. Standing limitations and open items

- Post-quantum protection ends at the sidecar; sidecar-to-core is plain HTTP authenticated by an HMAC-signed assertion.
- Certificates and token signatures are classical; ML-DSA and PQ PKI are out of scope (proposal section 21).
- One crypto provider is selectable (Node.js / OpenSSL); Bouncy Castle is PLANNED.
- The CBOM ground truth needs independent human review; HKDF and the benchmark/simulator service tokens are not yet in the usage register.
- Cross-machine benchmark runs and Experiment D are not done.
- Standards verification still required for any citation of RFC 10024 / IANA code points beyond what the tests observe on the wire.
