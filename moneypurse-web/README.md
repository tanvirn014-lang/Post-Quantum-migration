# MoneyPurse Web

MoneyPurse's web dashboard: a single authenticated page showing accounts, cash flow, spending
by category, savings pots, card management, and alerts, built against the `ledger-service`
backend (sibling project). Auth is stubbed for now — it renders straight to `/dashboard` as a
fixed demo customer. See `../docs/superpowers/specs/2026-10-30-moneypurse-dashboard-design.md`
for the full design.

## Prerequisites

`ledger-service` must be running separately on port 3000, with demo accounts seeded. (The seed
step is documented here once Task 5 adds it.)

## Running it

```bash
npm install
npm run dev -- -p 3100
```

Then open http://localhost:3100 (redirects to `/dashboard`).

Copy `.env.local.example` to `.env.local` if you need to point at a `ledger-service` instance
on a different URL than the default `http://localhost:3000`.
