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

Customer self-registration (`/signup`) is backed by a hosted Supabase project and is optional: set
`SUPABASE_URL` for ledger-service and `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the web app
(see the `.env*.example` files and section 7). Unset, the local sign-in still works and `/signup` shows "not configured".

## 2. Verify everything

```bash
npm run test:all       # ledger, security, sidecar and web suites (security tests need the PostgreSQL container)
npm run e2e            # drives the live stack through its real APIs; writes evidence/e2e/<run>/
npm run claim-audit    # restricted-claim scan over docs, UI and API strings
```

`npm run e2e` logs in five times, so wait a minute before running it again (login rate limit).

## 3. Suggested demo path (about 15 minutes)

0. **Customer sign-up** (`/signup`, only if Supabase is configured — section 7). Enter a name, a real email you can read,
   and a password; Supabase emails a 6-digit code; enter it to finish. The new account lands on `/dashboard`. The core
   provisions a local customer for the Supabase identity (`auth.external_provision` in the audit log). Staff still sign in
   locally at `/login`.
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
per-peer policy; everything marked SIM is a model; numbers are single-host loopback measurements. The Supabase sign-up is
an add-on identity layer whose tokens are classical (ES256), and it adds no post-quantum protection.
Do not say: that the system is quantum-resistant, that it was attacked, that it is production-ready or compliant, or
that the CBOM covers all cryptography. `docs/CLAIM_LEDGER.md` lists each claim with its evidence and limits.

## 7. Supabase setup (customer sign-up with email OTP)

The add-on identity layer uses a hosted Supabase project. One-time setup in the Supabase dashboard:

1. **Project → Settings → API.** Copy the **Project URL** (base, e.g. `https://<ref>.supabase.co` — not the
   `/rest/v1` endpoint) and the **anon / public** key. Under **JWT Keys**, confirm the project signs user tokens with
   **asymmetric keys (ECC/ES256)** so there is a public JWKS; no secret or service-role key is used here.
2. **Authentication → Providers → Email:** enable it with **"Confirm email" on**.
3. **Authentication → Email Templates → "Confirm signup":** make sure the template includes the code token
   `{{ .Token }}` (not only the magic-link `{{ .ConfirmationURL }}`), so step 2 of sign-up is a 6-digit code entry.
4. **Authentication → URL Configuration:** add the web origin (`http://localhost:3100`) to the allowed redirect/site URLs.

Then put the values in the git-ignored env files (templates in the `.env*.example` files):

```bash
# ledger-service/.env
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_AUTO_PROVISION=true   # required for self-service sign-up: lets the core create a local
                               # customer for a verified Supabase identity it has not seen before.
                               # Off by default (secure): without it, an unseen identity is refused
                               # unless an operator pre-created the customer (then it is linked).
                               # The core also checks the token audience (SUPABASE_AUDIENCE,
                               # default "authenticated").
# moneypurse-web/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
```

The anon key is a public browser value by design. The core verifies Supabase tokens against the project's public JWKS,
so it needs only `SUPABASE_URL`. Supabase's built-in email is rate-limited; it is adequate for a demo, not a production
mailer. The end-to-end OTP email round trip is a manual/demo check (an external service), not part of `npm run test:all`.

## 6. Troubleshooting

- `EADDRINUSE` on 3000/3100/3200/3300/8081/8443: an old process is still running; stop it before restarting.
- Sidecar reports "not ready": the security-service must be up first (the sidecar polls it for configuration).
- Security tests cannot connect: run `npm run db:up`; they use their own `security_test` database
  (override with `TEST_DATABASE_NAME`).
- Login returns 429: the login limiter is per client and per minute; wait a minute.
