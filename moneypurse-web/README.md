# MoneyPurse Web

MoneyPurse's web dashboard: a single authenticated page showing accounts, cash flow, spending
by category, savings pots, card management, and alerts, built against the `ledger-service`
backend (sibling project). Auth is stubbed for now — it renders straight to `/dashboard` as a
fixed demo customer. See `../docs/superpowers/specs/2026-10-30-moneypurse-dashboard-design.md`
for the full design and `../docs/superpowers/plans/2026-10-30-moneypurse-dashboard.md` for the
implementation plan this was built from.

## What maps to what

| Feature | UX pattern | Where |
| --- | --- | --- |
| Customizable dashboard | Modular home screen | "Customize" button → drag to reorder, "Hide" per widget (persisted to `localStorage`) |
| Spending insights | Progressive disclosure | Spending-by-Category donut → click a slice for a drawer of that category's transactions |
| Savings pots | Goal-oriented interface | Savings Pots widget — progress bars, "+ Add pot" |
| Card management | Contextual controls | Card widget — masked number, freeze/unfreeze, spend limit |
| Smart search | Search with suggestions | `⌘K` / header search box — real transactions + mock recipients/actions |
| Financial alerts | Contextual feedback | Bell dropdown + dismissible low-balance banner |

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
this checkout's local Postgres; re-run and re-paste if you reset the database — and note that
running `ledger-service`'s own Postgres integration test suite also wipes this seed data, since
its tests truncate the database between runs; reseed afterward if you need the demo UI again).

## Running it

```bash
npm install
npm run build
npm run dev -- -p 3100
```

Then open http://localhost:3100 (redirects to `/dashboard`).

Copy `.env.local.example` to `.env.local` if you need to point at a `ledger-service` instance
on a different URL than the default `http://localhost:3000`.

## Testing

```bash
npm test
```

Runs the unit suite (currency/date formatting, category guessing, cash-flow and
spending-by-category aggregation, the low-balance check, the ledger API client, the dashboard
layout persistence hook, and the `DashboardWidget` error/loading states) against compiled
output via Node's built-in test runner — not Vitest; see the toolchain note below.

Component visual correctness (does it look right, does the drag/hide/search/drawer interaction
actually work) is checked manually in the browser against the reference design, not automated —
that was a deliberate scope decision (see the design spec), not an oversight.

### A note on the toolchain

Like `ledger-service` (its own README has the fuller story), this project's test suite runs on
`tsc` + Node's built-in test runner rather than Vitest, because the sandbox this was built in
could not spawn Vitest's native `esbuild` subprocess. `tsconfig.tests.json` compiles to
CommonJS specifically so app-source files can use plain extensionless relative imports (the
convention Next.js's bundler expects) while still producing runnable test output — see that
file and the `lib/aggregate-cash-flow.ts` / `CashFlowChart.tsx` pairing for why a `.js`-suffixed
import works for a Node-run test file but breaks Next's own bundling of the same kind of file.

If you don't hit the sandboxing constraint on your own machine, Vitest + React Testing Library
would work fine here too and are a reasonable swap if your team prefers them.
