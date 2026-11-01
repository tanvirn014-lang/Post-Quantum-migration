# Research Readiness

**Verdict: RESEARCH VALIDATED on this host, with one caveat that blocks a clean CBOM claim.** 15/18 research requirements VERIFIED, 3 PARTIAL (`RES-010`, `RES-018`, and the CBOM independence issue). Evidence re-verified this audit: `npm run test:all` 617/617; recorded e2e 50/50 (`evidence/e2e/2026-11-01T00-24-56-403Z/`); benchmark `evidence/bench/2026-10-31T20-49-52-048Z-standard/` (valid run, checksummed).

## Classical TLS baseline (RES-001) — VERIFIED
`classical-baseline` TLS profile seeded (`security-service/migrations/0001_core.sql:14-17`); benchmark runs a classical X25519 arm under identical server config (`manifest.json` `supportedGroupsUnderTest`, `serverGroupList` identical for both conditions). e2e §3 observes `group=X25519 hello=235B`.

## Verified hybrid TLS (RES-002, PQC-001/002) — VERIFIED (LIVE)
Real TLS 1.3 handshakes negotiate `X25519MLKEM768` (code point 0x11ec; client share 1216 B, server share 1120 B — RFC 10024 sizes). Because `node:tls` cannot report the hybrid group, the negotiated group is read from the ServerHello **on the wire** (`pqc-sidecar/src/wire/observer.ts`; D-03) — the "verified handshake trace" the proposal permits. Asserted in `pqc-sidecar/tests/wire.test.ts` and observed live (e2e §3, §2 of report: server share 1120/32 B).

## Fallback tests (RES-008, PQC-003/004/005) — VERIFIED (LIVE)
All three required scenarios exist and pass live: permitted fallback (`classical-peer-fallback-allowed` → `allowed-fallback`), forbidden fallback (`classical-peer-fallback-forbidden` → `rejected-violation`), unknown/untrusted/no-cert peer (→ `rejected-unknown-peer`). Policy decision table in `pqc-sidecar/tests/policy.test.ts`; deny-by-default in `src/policy/evaluate.ts:53-65`.

## Policy-violation detection + visibility limits (RES-009, PQC-009) — VERIFIED (LIVE)
The controlled ClientHello-downgrade scenario (`clienthello-downgrade-tamper`) strips the hybrid group on-path; the handshake **fails via TLS transcript authentication** (`handshake-failed`), never silently completing on X25519. The code, tests and UI all document that the sidecar cannot distinguish a stripped hello from a genuinely classical client, so the detector scope is "policy violations visible to the sidecar," not universal downgrade/MITM detection (`src/peers/scenarios.ts:188-193`; `tests/scenarios.test.ts:165-173`; claim C-05). This is exemplary honesty about construct validity.

## Crypto-agility experiment (RES-012, AGI-004/010) — VERIFIED (LIVE)
Live TLS-profile switch applied to new connections without restart; `timeToApplyMs` recorded per config version (e2e §5: 837 ms to 5023 ms, poll-interval bound; H5 supported). Each change carries a hash-chained audit entry with the actor.

## CBOM validation (RES-010, CBOM-001..006) — PARTIAL (the one caveat)
CycloneDX 1.7 documents validate against the **vendored official schema** (hashes pinned in `security-service/schemas/cyclonedx-1.7/MANIFEST.md`; a `cbom.test.ts` guard recomputes them). Metrics are computed by canonical asset identity (`src/cbom/compare.ts`): run figures completeness **0.80**, precision **1.00**, location-recall **0.39**, 24 TP / 0 FP / 6 FN. Precision is structurally easy (the generator emits only what its sources provide), so completeness/recall are the informative figures and the misses are named.
**Caveat:** the ground truth (`ground-truth/cbom-ground-truth.json`) was prepared by the **same AI agent that wrote the generator** (self-declared at `:4`; echoed `status.ts:122`). The CI guard only checks the ground truth is not a copy of the register — it does **not** establish correctness or independence. **Do not publish CBOM precision/recall as validated until an independent human prepares or confirms the ground truth.** (`RES-010` PARTIAL.)

## HNDL simulator (RES-011) — VERIFIED (SIM)
Real primitives (X25519, ML-KEM-768, HKDF-SHA256, AES-256-GCM on throw-away keys; `src/hndl/simulator.ts`); the adversary is a **user-chosen assumption** (`none`/`x25519-broken`/`both-broken`), not an attack. Under `x25519-broken` the classical capture opens and the hybrid stays closed (AES-GCM auth fails without the ML-KEM secret); `both-broken` opens the hybrid too — illustrating "hybrid is as strong as its stronger half." Disclaimers assert no cryptanalysis and no prediction; output provably contains no secrets (`tests/hndl.test.ts:46-51`). Mosca X+Y>Z calculator labels years-to-quantum as the user's assumption.

## Benchmark reproducibility (RES-003..007, PERF-004..007) — VERIFIED (LIVE), loopback only
`evidence/bench/.../manifest.json` records commit (+dirty flag), host CPU/mem, Node/OpenSSL/V8, groups under test, resumption disabled, topology (loopback, single host, separate server process, `containers: none`), workload (30 runs × 300 handshakes, 100 warm-up), measurement (monotonic timer, interleaving classical/hybrid-first alternating, R-7 percentiles, **bootstrap CIs resampling runs** with a recorded seed), and 5 explicit caveats. Raw CSVs retained with SHA-256 checksums. A **validity gate** (>0.5% failure) blocks publishing; **two invalid runs are kept and explained** (`evidence/bench/invalid/README.md`). **Gap (RES-007):** only full handshakes are benchmarked — session resumption is not.

## Hypothesis support (claim ledger H1–H6)
| H | Result | Basis |
|---|---|---|
| H1 extra handshake bytes | Supported (+~1176 B CH / +1088 B SH; shares 1216/1120 B) | bench + e2e |
| H2 extra computation | Supported, small (+0.265 ms, 95% CI 0.15–0.38 ms over 30 runs) | bench |
| H3 every classical negotiation classified | Not refuted | policy tests + e2e §6 |
| H4 CBOM captures declared-scope assets | Partly supported (completeness 0.80, 6 FN) — **pending independent ground truth** | §11 |
| H5 profile change no-restart + audited | Supported (3.9–4.9 s) | e2e §5 |
| H6 simulator contrast | Illustrated | hndl.test.ts |

## Experimental limitations (as documented + audit additions)
Single-host loopback (no capacity/production-latency claim); Node/OpenSSL stack only (not the Java/BCJSSE named in the proposal); one selectable provider; ground-truth independence (above); no resumption benchmark; Experiment D (HNDL on real captures) out of scope; standards-citation verification of IANA code points still required beyond what is observed on the wire.

## Publication-evidence readiness
**Ready to write up** for H1/H2/H3/H5 and the security scenarios (B/C/E) with the retained, checksummed evidence and the traceability matrix. **Not yet publishable as validated** for the CBOM completeness/precision claim (H4) until independent ground truth exists (`RES-010`), and the paper should add a consolidated validity-threats section (`RES-018`: internal — single host/shared CPU; external — one machine/stack; construct — group read from wire not API, detector visibility limits; conclusion — paired within-run diffs only, CIs over runs).
