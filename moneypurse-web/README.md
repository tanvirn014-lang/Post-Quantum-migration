# MoneyPurse Web

MoneyPurse's web dashboard: a single authenticated page showing accounts, cash flow, spending
by category, savings pots, card management, and alerts, built against the `ledger-service`
backend (sibling project). Auth is stubbed for now — it renders straight to `/dashboard` as a
fixed demo customer. See `../docs/superpowers/specs/2026-10-30-moneypurse-dashboard-design.md`
for the full design.

## Prerequisites

`ledger-service` must be running separately on port 3000, with demo accounts seeded:

```bash
cd ../ledger-service
docker compose up -d
DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger npm run migrate
npm run build
DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger node dist/scripts/seed-demo.js
```

Copy the printed `primary`/`savings` account ids into `lib/demo-accounts.ts` (already done for
this checkout's local Postgres; re-run and re-paste if you reset the database).

## Running it

```bash
npm install
npm run dev -- -p 3100
```

Then open http://localhost:3100 (redirects to `/dashboard`).

Copy `.env.local.example` to `.env.local` if you need to point at a `ledger-service` instance
on a different URL than the default `http://localhost:3000`.
