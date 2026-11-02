# M9 — Independent CBOM ground-truth validation

**Problem (audit F15 / RES-010 / CBOM-005):** the CBOM completeness/precision numbers are measured
against `security-service/ground-truth/cbom-ground-truth.json`, which was prepared by the **same AI
agent that wrote the generator** — so it is **not independent**, and the H4 figures cannot be claimed
as validated. This milestone delivers everything needed for an **independent human** to build a
reference inventory and validate the generator, and leaves that human sign-off **explicitly pending**
(it is not fabricated).

## 1. The template
`security-service/ground-truth/cbom-ground-truth.template.json` — an annotated, schema-valid skeleton.
Fields (enforced by `groundTruthInputSchema` in `security-service/src/cbom/compare.ts`):
- `scope` — what was inventoried. `preparedBy` — the reviewer + method (must be independent).
  `excluded` — deliberate exclusions.
- `items[]` — one per asset: `id`, `kind` ∈ `{algorithm, protocol, certificate, related-crypto-material}`,
  `name`, `expectedProvenance` (`declared` = named in source/config, `observed` = only in runtime
  telemetry), optional `expected` attributes (`primitive`, `algorithmFamily`, `parameterSetIdentifier`,
  `ellipticCurve`), `locations[]` (repo-relative), `notes`.

## 2. Sourcing guide — where to find each asset class (inspect the SOURCE, not the generator)
Grep anchors: `createHash`, `createHmac`, `createCipheriv`, `scrypt`, `generateKeyPair`,
`diffieHellman`, `"aes-256-gcm"`, `EdDSA`, `ES256`, `ecdhCurve`, `minVersion`.

| Asset class (`kind`) | Where to look |
|---|---|
| **algorithm** — TLS key-agreement groups (X25519, ML-KEM-768, X25519MLKEM768) | `pqc-sidecar/src/wire/groups.ts`, `security-service/src/domain/crypto.ts`, `pqc-sidecar/src/peers/client.ts`, `pqc-sidecar/src/bench/{harness,cli}.ts` |
| **algorithm** — signatures (ECDSA P-256, EdDSA, ES256) | `pqc-sidecar/src/pki/generate.ts` (ECDSA certs), `ledger-service/src/identity/tokens.ts` (EdDSA JWT), `ledger-service/src/adapters/supabase/verifier.ts` (ES256) |
| **algorithm** — KDF/hash/MAC/cipher (scrypt, SHA-256, HKDF-SHA256, HMAC-SHA256, AES-256-GCM) | `ledger-service/src/identity/password.ts` (scrypt), `*/src/audit/chain.ts` + `src/adapters/postgres/audit-append.ts` (SHA-256 chain), `ledger-service/src/partner/assertion.ts` + `pqc-sidecar/src/sidecar/assertion.ts` (HMAC-SHA256), `ledger-service/src/crypto/kms.ts` (AES-256-GCM envelope — M4), `security-service/src/hndl/simulator.ts` (X25519/ML-KEM/HKDF/AES-GCM) |
| **protocol** — TLS 1.3 | `pqc-sidecar/src/sidecar/server.ts` (min/maxVersion), `pqc-sidecar/src/internal-mtls.ts` (M8), `pqc-sidecar/src/wire/*` |
| **certificate** — X.509 (ECDSA P-256) | `pqc-sidecar/src/pki/generate.ts`, the generated `pqc-sidecar/.secrets/pki/*` (public certs only), `security-service/tests/fixtures/pki/*.pem` |
| **related-crypto-material** — keys/secrets/tokens/digests | `ledger-service/.secrets/jwt-ed25519.pem` (JWT key), env names in the `*/.env.example` files and `scripts/setup.mjs`: `SIDECAR_ASSERTION_SECRET`, `SIDECAR_TOKEN`, `BENCH_TOKEN`, `PEER_SIM_TOKEN`, `KMS_MASTER_KEY` (M4); refresh-token SHA-256 hashes (`tokens.ts`), audit hash-chain digests (`audit/chain.ts`), scrypt password hashes, peer cert fingerprints (`pqc-sidecar/src/sidecar/client-cert.ts`) |
| **dependency crypto libraries** (excluded from the comparison, but note them) | `*/package-lock.json`: `jose`, `@peculiar/x509` |
| **observed-only** (`expectedProvenance: "observed"`) | distinct `(group, cipher, tlsVersion)` tuples from connection telemetry — `security-service/src/repos/cbom.ts` `observedInventory`; inspect live telemetry, not the generator |

## 3. Reproducible independent-review procedure
1. **Assign an independent reviewer** — not the generator's author, and not an AI acting on that
   author's behalf.
2. Working **only** from §2 and the source tree (do **not** open `src/cbom/generator.ts` or the
   existing `cbom-ground-truth.json`), copy the template to `cbom-ground-truth.independent.json` and
   fill it in. Record the exact commit SHA in `scope`.
3. **Install it as the active ground truth:** replace `security-service/ground-truth/cbom-ground-truth.json`
   with the independent file (or seed it as a new `cbom_ground_truth` version), keeping the AI-prepared
   one archived for comparison.
4. **Run the diff** (the comparison tooling already exists — see §4): generate a CBOM and compare it to
   the active ground truth. It reports TP / FP / FN, scoped precision / completeness / location-recall,
   and typed discrepancies (`missing`, `unexpected`, `provenance-mismatch`, `attribute-mismatch`,
   `location-gap`).
5. **Adjudicate** each discrepancy: decide whether the generator or the ground truth is correct, and
   record the decision. Re-run until the inventory is stable.
6. **Record and sign off** in §5. Only then may the completeness/precision figures be cited as validated.

## 4. Diff tooling (already implemented)
`compareToGroundTruth()` in `security-service/src/cbom/compare.ts`, surfaced through the CBOM
comparison API and the `/security/cbom` console page, **is** the diff tool. It matches assets by
canonical identity (never by position), excludes library components, and emits the metrics and typed
discrepancies above against whatever ground-truth version is active. The procedure in §3 simply points
it at the independently-prepared ground truth instead of the AI-prepared one. Tests:
`security-service/tests/cbom.test.ts`.

## 5. Sign-off — **PENDING**
This cannot be fabricated; it is left open for a real reviewer.

| Field | Value |
|---|---|
| Independent reviewer (name / role) | _pending_ |
| Not the generator's author? | _pending_ |
| Commit SHA reviewed | _pending_ |
| Date | _pending_ |
| Result (completeness / precision / location-recall) | _pending_ |
| Discrepancies adjudicated | _pending_ |
| Statement | _pending_ |

**Status:** RES-010 / CBOM-005 remain **PARTIAL** until this sign-off is completed. Template, sourcing
guide, procedure and diff tooling are **delivered (LOCAL)**; the independent human validation is
**HUMAN / pending** by design.
