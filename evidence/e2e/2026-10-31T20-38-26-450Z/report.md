# End-to-end validation 2026-10-31T20-38-26-450Z

Commit b5c5b91bcaec (working tree had uncommitted changes) · Node 26.4.0 · OpenSSL 3.5.7 · win32 10.0.26200 12th Gen Intel(R) Core(TM) i5-12500H
**50 passed, 0 failed, 0 skipped.** Single host, loopback, simulated peers; not a production deployment.

## 1. Services

| result | check | detail |
|---|---|---|
| PASS | ledger is healthy | HTTP 200 |
| PASS | security is healthy | HTTP 200 |
| PASS | sidecar is healthy | HTTP 200 |
| PASS | simulator is healthy | HTTP 200 |
| PASS | the sidecar is ready and has applied a configuration | config v9, profile hybrid-preferred |

## 2. Authentication and role-based access

| result | check | detail |
|---|---|---|
| PASS | a wrong password is rejected with a generic error |  |
| PASS | a customer cannot read the security console |  |
| PASS | an operator cannot read the security console |  |
| PASS | an auditor can read the security console |  |
| PASS | an auditor cannot change the TLS profile |  |
| PASS | a customer cannot read the audit log |  |
| PASS | a customer sees only their own accounts |  |
| PASS | a customer cannot read another customer's account (same 404 as nonexistent) |  |
| PASS | a negative transfer amount (which would reverse direction) is rejected |  |

## 3. Experiment B and C scenarios (simulated peers -> sidecar, real TLS 1.3)

| result | check | detail |
|---|---|---|
| PASS | scenario hybrid-peer-hybrid-required: expected allowed-hybrid, observed allowed-hybrid | group=X25519MLKEM768 hello=1457B |
| PASS | scenario classical-peer-fallback-allowed: expected allowed-fallback, observed allowed-fallback | group=X25519 hello=235B |
| PASS | scenario classical-peer-fallback-forbidden: expected rejected-violation, observed rejected-violation | group=X25519 hello=235B |
| PASS | scenario unregistered-peer: expected rejected-unknown-peer, observed rejected-unknown-peer | group=X25519MLKEM768 hello=1457B |
| PASS | scenario untrusted-certificate: expected rejected-unknown-peer, observed rejected-unknown-peer | group=X25519MLKEM768 hello=1457B |
| PASS | scenario no-client-certificate: expected rejected-unknown-peer, observed rejected-unknown-peer | group=X25519MLKEM768 hello=1457B |
| PASS | scenario clienthello-downgrade-tamper: expected handshake-failed, observed handshake-failed | group=X25519 hello=1457B |
| PASS | hybrid server key share is 1120 bytes (RFC 10024) and classical is 32 | 1120 / 32 |

## 4. End-to-end partner payments (peer -> sidecar -> core -> ledger)

| result | check | detail |
|---|---|---|
| PASS | partner-payment-hybrid: allowed-hybrid | tx txn_b30a609d-5a34-4eab-9c96-000741965973 |
| PASS | partner-payment-hybrid: the ledger transaction records the verified key exchange | {"decision":"allowed-hybrid","keyExchange":"hybrid","negotiatedGroup":"X25519MLKEM768"} |
| PASS | partner-payment-classical-fallback: allowed-fallback | tx txn_d1e6d579-16e5-475e-8928-1b4c2d62bcee |
| PASS | partner-payment-classical-fallback: the ledger transaction records the verified key exchange | {"decision":"allowed-fallback","keyExchange":"classical","negotiatedGroup":"X25519"} |
| PASS | the customer balance rose by exactly the two payments | 25020000 -> 25025000 |
| PASS | a direct call to the core with a forged assertion is refused |  |
| PASS | double entry holds across the whole ledger: all balances sum to zero | sum=0, 14 accounts |

## 5. Experiment E: live TLS profile switch (crypto agility)

| result | check | detail |
|---|---|---|
| PASS | the sidecar applies the new profile to new connections without a restart | applied after 3040 ms (polling interval bound) |
| PASS | under hybrid-only a classical-only handshake is refused | observed handshake-failed |
| PASS | under hybrid-only a hybrid peer still connects |  |
| PASS | under the classical baseline even a hybrid-capable peer is forced onto X25519 (hybrid-required policy then rejects it) | observed rejected-violation |
| PASS | restoring hybrid-preferred restores hybrid |  |
| PASS | time-to-apply is recorded per configuration version | 4874ms, 4786ms, 3009ms |
| PASS | every profile change is in the configuration audit log with the actor |  |

## 6. Telemetry and alerts

| result | check | detail |
|---|---|---|
| PASS | telemetry contains 'allowed-hybrid' events | 10 in 24h |
| PASS | telemetry contains 'allowed-fallback' events | 6 in 24h |
| PASS | telemetry contains 'rejected-violation' events | 5 in 24h |
| PASS | telemetry contains 'rejected-unknown-peer' events | 9 in 24h |
| PASS | telemetry contains 'handshake-failed' events | 5 in 24h |
| PASS | the sidecar reports in sync and not stale |  |
| PASS | a security admin can acknowledge an alert |  |

## 7. Audit integrity

| result | check | detail |
|---|---|---|
| PASS | the banking audit chain verifies | 55 events, head ebfe4f1cd014 |
| PASS | the security configuration audit chain verifies | 33 events, head 042af72340e9 |

## 8. Research features (checked only when deployed)

| result | check | detail |
|---|---|---|
| PASS | a CycloneDX CBOM is generated and validates against the schema | id 65cf2aa3-4fdd-422b-9ef5-c1c789a9e8fb |
| PASS | the CBOM is compared with the manually prepared ground truth | completeness 0.8, precision 1 |
| PASS | the HNDL simulator labels itself a simulation | Educational simulation. It does not break any real key and runs no quantum algorithm: the adversary's capability is an assumption you choose, and the cryptography it then meets is real. Nothing here predicts when, or whether, such a computer will exist. |
| PASS | under an assumed X25519 break the classical capture opens and the hybrid capture stays closed | The X25519 half was recovered but the session key also depends on the ML-KEM-768 secret, which the adversary does not have. The AES-GCM authentication check fails, so the recording stays closed. |
| PASS | the Mosca calculator reports 3 exposure years for X=10, Y=5, Z=12 |  |
