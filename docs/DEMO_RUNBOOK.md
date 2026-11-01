# Demo and reproduction runbook

A single-host research prototype: PostgreSQL in Docker plus five Node processes. Everything below uses commands that
exist in this repository. Prerequisites: a Node build whose OpenSSL is 3.5 or newer, which provides X25519MLKEM768 and ML-KEM in `node:crypto`
(developed and tested on Node 26.4.0 / OpenSSL 3.5.7; other versions are untested), Docker, Git.

## 1. Start from a clean checkout

```bash
npm run install:all
npm run setup          # per-service .env files, secrets, research PKI (idempotent, never overwrites)
npm run db:up
npm run migrate
npm run seed           # staff + customer demo accounts; credentials go to ledger-service/.secrets/ (git-ignored)
```

Start each of these in its own terminal:

```bash
npm run dev:ledger     # banking core and identity provider   :3000
npm run dev:security   # security control plane               :3200
npm run dev:sidecar    # hybrid TLS 1.3 sidecar                TLS :8443, admin :8081
npm run dev:simulator  # simulated external peers              :3300
npm run dev:web        # web console                           :3100
```

```bash
npm run register-peers # registers the simulated peers' certificate fingerprints
```

Demo credentials are in `ledger-service/.secrets/demo-credentials.json`. Roles: customer (`/dashboard`), operator
(`/operations`), security_admin and auditor (`/security`). Accounts are test data created by the seed script.

## 2. Verify everything

```bash
npm run test:all       # ledger, security, sidecar and web suites (security tests need the PostgreSQL container)
npm run e2e            # drives the live stack through its real APIs; writes evidence/e2e/<run>/
npm run claim-audit    # restricted-claim scan over docs, UI and API strings
```

`npm run e2e` logs in five times, so wait a minute before running it again (login rate limit).

## 3. Suggested demo path (about 15 minutes)

1. **Customer view** (`/dashboard`, sign in as a customer). Real balances and transactions. Savings pots, card controls and
   search suggestions are labelled SIM: they have no backend.
2. **Security console** (`/security`, sign in as security_admin).
   - *Implementation status*: every component is LIVE, SIM or PLANNED with its evidence file and limitations.
   - *Experiments*: run `hybrid-peer-hybrid-required`, `classical-peer-fallback-allowed`,
     `classical-peer-fallback-forbidden`, `unregistered-peer`, `clienthello-downgrade-tamper`. Each shows expected vs
     observed from a real TLS handshake against the sidecar. Note what the tamper scenario shows and what it cannot show.
   - *Telemetry*: the resulting events, decisions, key-exchange class and alerts (acknowledge one).
   - *Crypto agility*: switch the active profile, watch the sidecar pick it up without a restart, run a scenario again, and
     read time-to-apply and the audit entry.
3. **Partner payment, end to end.** Run `partner-payment-hybrid` and `partner-payment-classical-fallback` with the
   customer's account id. Sign back in as that customer: the new transactions carry a badge saying which key exchange
   protected the connection that delivered them, with the stated limits.
4. **CBOM**: generate, open the validation result, compare with the ground truth and read the caveats on the numbers.
5. **HNDL simulator** (labelled SIMULATION): run with `x25519-broken`, then `both-broken`; try the Mosca calculator.
6. **Benchmarks**: open the recorded run, its manifest, the confidence interval and the caveats; download the raw CSV.
7. **Audit log**: verify the hash chain in both services.

## 4. Reproduce the benchmark

```bash
npm run bench -- --preset standard --label "my machine" --publish
```

Needs `SECURITY_SERVICE_URL` and `BENCH_TOKEN` in the environment to publish (otherwise it only writes
`evidence/bench/<run>/`). Close other heavy programs first: client and server share the machine's CPU. A run whose failure
rate exceeds 0.5% is flagged INVALID, written to disk, and never published. `--preset full` is the proposal's 30 runs of 1000.

## 5. What to say, and what not to

Say: hybrid key establishment was verified on the wire for capable peers; classical fallback is an explicit, labelled,
per-peer policy; everything marked SIM is a model; numbers are single-host loopback measurements.
Do not say: that the system is quantum-resistant, that it was attacked, that it is production-ready or compliant, or
that the CBOM covers all cryptography. `docs/CLAIM_LEDGER.md` lists each claim with its evidence and limits.

## 6. Troubleshooting

- `EADDRINUSE` on 3000/3100/3200/3300/8081/8443: an old process is still running; stop it before restarting.
- Sidecar reports "not ready": the security-service must be up first (the sidecar polls it for configuration).
- Security tests cannot connect: run `npm run db:up`; they use their own `security_test` database
  (override with `TEST_DATABASE_NAME`).
- Login returns 429: the login limiter is per client and per minute; wait a minute.
