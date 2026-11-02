# Per-hop communication protection (M8)

Every network hop, what protects it, and whether that protection is post-quantum. **Post-quantum
key establishment exists only at the external peer→sidecar boundary; every other hop is classical.**
Certificates and token signatures are classical (ECDSA P-256 / EdDSA / ES256) throughout, by design
(the proposal scopes PQ signatures/PKI out).

| # | Hop | Transport | Authentication | Key establishment | PQ? | Status |
|---|---|---|---|---|---|---|
| 1 | external peer → **pqc-sidecar** | TLS 1.3, mutual | client-cert fingerprint (classical ECDSA) + deny-by-default registry | **X25519MLKEM768 (hybrid)**, or classical X25519 for `classical-allowed` peers (labelled exposure) | **Yes** (KE only) | VERIFIED (LIVE) |
| 2 | **pqc-sidecar → ledger core** (`/partner/*`) | TLS 1.3 mutual (M8 `internal-mtls`) + HMAC-signed, replay-proof assertion (M1) | mutual TLS (classical ECDSA, internal dev PKI) + HMAC `jti` assertion | TLS 1.3 (classical) | No | mTLS transport + PKI + revocation **VERIFIED** (real-TLS tests); **live wiring is an integration/deploy step** — the core must serve the mTLS partner listener and the sidecar attach its client cert to the (already-https-capable) upstream request |
| 3 | pqc-sidecar → security-service (config pull / telemetry push) | HTTP + static bearer token | bearer token | none | No | NOT ADDRESSED by M8 (internal network control; same mTLS pattern applies — follow-up) |
| 4 | web ↔ ledger / security (user + staff API) | HTTP in the prototype; TLS termination at the edge in production | EdDSA / ES256 JWT (classical) | TLS at deploy (classical) | No | TLS is a deploy control (INFRA) |
| 5 | services ↔ PostgreSQL | no TLS in the prototype; TLS at deploy | DB credentials | none in-repo | No | TLS is a deploy control (INFRA). PII (`customers.full_name`) is envelope-encrypted at rest (M4). |
| 6 | ledger core ↔ Supabase (token verify / JWKS) | HTTPS (external service) | — (public JWKS) | TLS to Supabase (classical) | No | external dependency |

## What M8 delivered (LOCAL, verified)
- A **dev PKI** (internal CA → server + client certs, ECDSA P-256, correct EKU/SAN), reusing `pqc-sidecar/src/pki/generate.ts`.
- `pqc-sidecar/src/internal-mtls.ts`: an **mTLS server** (TLS 1.3, `requestCert` + `rejectUnauthorized` against the internal client CA) with a **revocation deny-list**, and an **mTLS client agent** pinning the server CA.
- Real-TLS tests (`pqc-sidecar/tests/internal-mtls.test.ts`): a valid client cert is accepted; **no certificate, a foreign-CA certificate, and a revoked certificate are all rejected** (handshake failure or 403).

## What remains (INFRA / integration)
- **Live wiring of hop 2:** the ledger core must expose its `/partner/*` API on a mTLS listener (the sidecar already forwards over https when `UPSTREAM_URL` is https — the `internalMtlsAgent` plugs into that request). This touches the core's HTTP stack and is a deploy/config change, so it is not enabled in the running stack here.
- **Hop 3** internal mTLS (same pattern), **hops 4–5** TLS termination and Postgres TLS, and an **OCSP/CRL responder** (M8.c production) are deployment/infrastructure controls.

Requirement status: SEC-001/002 → PARTIAL (internal mTLS transport + PKI + revocation verified locally; live hop-2/3 wiring and edge/DB TLS are INFRA). PQC-012 → PARTIAL (revocation via deny-list verified; OCSP/CRL is INFRA).
