# Ledger Service

Core double-entry ledger and account service for the digital banking platform (Bangladesh MVP).
This is the foundation the rest of the platform (onboarding, payments, cards) builds on top of,
per the core platform spec's Phase 1 scope and the Evaluation report's recommendation to buy the
non-differentiating pieces and build the ledger in-house.

## What this is

- A standalone HTTP service owning the **Account**, **Transaction**, and **Posting** domains.
- Double-entry bookkeeping: every transaction is a set of postings that must net to zero per
  currency, enforced in the domain layer, in the store's atomic unit of work, and again at the
  database level by a trigger (defense in depth - see `migrations/0001_init.sql`).
- Idempotent writes: every mutating request requires an `Idempotency-Key`; retrying the same
  request returns the original result instead of posting twice, and reusing a key with a
  different payload is rejected.
- Money is always an integer in minor units (poisha/cents) plus a currency code - never a float.

## What this is not (yet)

This is the ledger core only. Authentication/authorization, KYC/onboarding, card issuance,
external payment-rail integration (NPSB/BEFTN/RTGS), and the mobile/web clients are separate
services per the platform's modular architecture and are not part of this repo.

## Architecture

```
src/
  domain/      Money, Account/Posting/Transaction types, the balanced-transaction invariant,
               and typed domain errors. No framework or I/O dependencies.
  ports/       LedgerStore - the interface the application layer depends on.
  adapters/
    memory/    In-process LedgerStore for tests and local development without Postgres.
    postgres/  Real LedgerStore: row-locked transactions, idempotency via a unique
               constraint, migrations.
  app/         LedgerService - the use-case layer (createAccount, transfer, postTransaction).
  http/        Fastify routes, request validation (zod), DTO serialization, error mapping.
```

Swapping `LEDGER_STORE=memory` for `LEDGER_STORE=postgres` changes nothing above the `ports/`
layer - this is the hexagonal/ports-and-adapters shape the NFR doc's maintainability section
calls for.

## Running it

```bash
npm install
npm run build
LEDGER_STORE=memory npm start
```

Then:

```bash
curl -X POST localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"ownerCustomerId":"11111111-1111-1111-1111-111111111111","currency":"BDT","allowOverdraft":true}'
```

### With real Postgres

```bash
docker compose up -d        # starts Postgres on localhost:5432 (see docker-compose.yml)
cp .env.example .env        # set LEDGER_STORE=postgres
npm run migrate             # applies migrations/0001_init.sql
LEDGER_STORE=postgres DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger npm start
```

### CORS

By default the API reflects whatever `Origin` header a browser sends (fine for local
development, where the frontend runs on an arbitrary port). For a real deployment, set
`CORS_ORIGIN` to a comma-separated allow-list instead of relying on that default:

```bash
CORS_ORIGIN=https://app.example.com,https://admin.example.com npm start
```

Leave it unset in dev; always set it in production. `buildServer`'s `cors` option (used in
tests) can also take `false` to disable CORS outright.

## Testing

```bash
npm test
```

26 tests cover the domain invariant (balanced/unbalanced transactions, multi-currency), the
service layer (transfers, overdraft rejection, idempotent replay, idempotency-key reuse,
unknown-account and currency-mismatch errors) and the HTTP API, all against the in-memory store
so they run with no external dependencies.

A further 9 tests (`tests/adapters/postgres-ledger-store.integration.test.ts`) run the same kind
of checks against a **real Postgres**, plus two things only Postgres can prove: a direct-SQL test
that the database trigger rejects an unbalanced transaction even when the application layer is
bypassed, and a concurrency test firing two opposite-direction transfers between the same two
accounts at once to confirm the sorted-lock-order avoids a deadlock. They're skipped automatically
when `DATABASE_URL` isn't set; to run them:

```bash
docker compose up -d
DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger npm run migrate
DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger npm test
```

All 35 tests pass this way, and the server was also smoke-tested end-to-end against real Postgres
with curl, including restarting it mid-session to confirm balances actually persist (they do).

### A note on the toolchain

This was built in a sandboxed environment where Node could not spawn native child-process
binaries (esbuild, used internally by Vite/Vitest and by `tsx`, failed with `ENOENT` even though
the binary was present and ran fine when invoked directly from a shell). That ruled out Vitest
and `tsx`. The project instead uses:

- **`tsc`** to compile (a pure-JS compiler, no subprocess spawning) instead of `tsx`/esbuild.
- **Node's built-in test runner** (`node --test`, available since Node 18, stable since Node 20)
  instead of Vitest.

Both are standard, dependency-light choices on their own merits, not just a workaround - but the
reason they were picked *here* was this constraint. If you don't hit the same restriction on your
machine, Vitest + `tsx` would work too and are a reasonable swap if your team prefers them.

## Design notes worth knowing before extending this

- **Posting sign convention:** a posting's `amountMinorUnits` is positive to credit (increase) an
  account and negative to debit (decrease) it. A transaction is valid when postings for each
  currency sum to zero.
- **Account IDs are not bare UUIDs** - they're `acc_<uuid>` (and transactions `txn_<uuid>`,
  postings `pst_<uuid>`), a Stripe-style convention for readability in logs. The HTTP layer's
  validation reflects this (`z.string().min(1)`, not `.uuid()`) - don't "fix" that.
- **The Postgres adapter locks accounts in sorted-by-id order** before validating balances, so two
  concurrent transfers that touch the same two accounts in opposite order can't deadlock.
- **Idempotency replay vs. reuse:** retrying the same `Idempotency-Key` with an identical body
  returns the original transaction (HTTP 201, same id). Retrying it with a *different* body
  returns `409 IDEMPOTENCY_KEY_REUSED` - this is deliberate; silently accepting the new payload
  would hide a client bug.
