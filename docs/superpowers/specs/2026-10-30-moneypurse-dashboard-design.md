# MoneyPurse Web — Initial Dashboard Design

Date: 2026-10-30
Status: approved by user, pending implementation plan

## 1. Purpose and scope

Build the first frontend for the digital banking platform: a single authenticated
dashboard page, styled as a dark-theme fintech app under the brand **MoneyPurse**,
implementing six required UX patterns:

| Feature | Pattern | Widget |
| --- | --- | --- |
| Customizable dashboard | Modular home screen | `DashboardWidget` shell (hide/reorder) wrapping every widget below |
| Spending insights | Progressive disclosure | `SpendingByCategoryChart` → drawer with filtered transactions |
| Savings pots | Goal-oriented interface | `SavingsPotsWidget` |
| Card management | Contextual controls | `CardManagementWidget` |
| Smart search | Search with suggestions | `SmartSearch` (header) |
| Financial alerts | Contextual feedback | `AlertsDropdown` + inline banners |

The reference image (dark dashboard, sidebar nav, summary cards, cash-flow bar chart,
spending donut, savings goals, recent transactions) is a **mood/layout reference**, not a
literal brand or currency target — MoneyPurse uses its own palette and BDT currency.

**Out of scope for this build** (explicitly, to prevent scope creep mid-implementation):
- Real authentication/login. The app renders straight to `/dashboard` as a fixed demo
  customer. No signup, no session management, no protected-route logic.
- Any change to `ledger-service` (the existing backend). This build only *consumes* its
  existing API; if a gap is found, it is worked around in the frontend (see §4) rather than
  by adding backend endpoints.
- Mobile app, settings pages, onboarding/eKYC, payments initiation beyond what already
  exists as a demo transfer, multi-account-type switching (the image's
  Individual/Universal/Business tabs — the backend has one account type, so this build
  shows the demo customer's own accounts only, no fabricated account-type switcher).
- Automated visual regression testing and end-to-end tests. Covered instead by: manual
  comparison against the reference image during the browser preview, and unit tests for
  logic (formatting, filtering, layout persistence).

## 2. Tech stack

- **Next.js (App Router) + React + TypeScript + Tailwind CSS** (user's explicit choice).
- **TanStack Query** for server-state fetching/caching (accounts, transactions) and for
  giving the mock data sources the same async, cached, loading/error-state shape as real
  API calls — components never know which kind they're getting.
- **Radix UI primitives** (`@radix-ui/react-*`) for anything interactive that needs
  accessibility handled correctly: dropdown menus, tooltips, dialogs/drawers.
- **Recharts** for the cash-flow bar chart and spending-by-category donut chart.
- **cmdk** for the smart search command-palette pattern (search-with-suggestions).
- **@dnd-kit/core** for drag-to-reorder widgets in the dashboard's edit mode.
- **Vitest + React Testing Library** for unit tests.

No state-management library beyond React Query + local component state + one small
`localStorage`-backed hook for dashboard layout — a global store (Redux/Zustand) would be
unused weight at this scope (YAGNI).

## 3. Project layout

New sibling folder to `ledger-service/`, independent `package.json` — not a monorepo tool,
since there are only two projects and they don't share code yet:

```
moneypurse-web/
  app/
    layout.tsx              # root layout: fonts, theme class, QueryClientProvider
    page.tsx                # redirects to /dashboard
    dashboard/
      page.tsx              # the dashboard screen; composes AppShell + widgets
  components/
    layout/
      AppShell.tsx
      Sidebar.tsx
      Header.tsx
    dashboard/
      DashboardWidget.tsx    # common shell: title, hide/reorder affordances, error boundary
      AccountSummaryCards.tsx
      CashFlowChart.tsx
      SpendingByCategoryChart.tsx
      SavingsPotsWidget.tsx
      CardManagementWidget.tsx
      RecentTransactionsWidget.tsx
    search/
      SmartSearch.tsx
    alerts/
      AlertsDropdown.tsx
      AlertBanner.tsx
    ui/                      # small reusable primitives: Card, Button, Badge, ProgressBar,
                              # Avatar, Drawer, Dropdown - all Tailwind + Radix, no business logic
  hooks/
    useAccounts.ts
    useTransactions.ts
    useSavingsPots.ts
    useCards.ts
    useAlerts.ts
    useSearchSuggestions.ts
    useDashboardLayout.ts     # widget order/visibility, persisted to localStorage
  lib/
    api/
      ledger-client.ts        # typed fetch wrapper for the real ledger-service endpoints
      types.ts                # Account/Transaction/Posting types, mirroring the backend DTOs
    mock/
      pots.ts
      cards.ts
      alerts.ts
      search.ts
      categorize.ts           # deterministic keyword-based category guesser (see §4)
    format.ts                 # BDT currency formatting, relative dates
    demo-accounts.ts          # the fixed demo customer's known account ids (see §4)
  styles/
    globals.css               # Tailwind layers + CSS variable design tokens (dark palette)
  tailwind.config.ts
```

## 4. Data layer — what's real vs. mocked, and why

This is the most important section to get unambiguous, because `ledger-service` only
implements the core ledger (accounts, transactions, postings) — it has no concept of
"customer's list of accounts," categories, merchants, savings pots, cards, or alerts.

| Data | Source | Detail |
| --- | --- | --- |
| Account balance | **Real** — `GET /accounts/:id` | `ledger-service` has no "list accounts for a customer" endpoint. Workaround: `lib/demo-accounts.ts` hardcodes the demo customer's known account ids (created by a one-time seed script, §7), and the frontend fetches each by id. This avoids touching the backend. |
| Transaction history | **Real** — `GET /accounts/:id/postings` | Real amount, currency, description, timestamp. |
| Cash flow (income vs. expense per period) | **Real, computed client-side** | Derived by summing real postings per period (positive = income, negative = expense). No backend aggregation endpoint needed. |
| Spending category | **Mocked on top of real data** — `lib/mock/categorize.ts` | The backend has no category field. A deterministic keyword match against each real posting's `description` assigns a category (e.g. "grocery", "bKash", "rent" → Groceries/Transfer/Housing), falling back to "Other". This is a presentation-layer guess, not a backend feature — documented in the component's code comment so it isn't mistaken for real categorization later. |
| Savings pots | **Fully mocked** — `lib/mock/pots.ts` | No backend concept exists. Static fixture data with goal/target/progress. |
| Cards | **Fully mocked** — `lib/mock/cards.ts` | No card-issuance backend yet (per the platform's own roadmap, this is a later module). Static fixture: masked number, type, frozen state (toggleable in local state only, not persisted). |
| Alerts (low balance, upcoming bill, unusual spending) | **Fully mocked** — `lib/mock/alerts.ts` | No fraud/monitoring backend yet. Static fixture, with the "low balance" alert's threshold check run client-side against the real account balance (the one piece of real logic in this widget). |
| Smart search suggestions | **Fully mocked** — `lib/mock/search.ts` | Searches across mocked recipients/actions; real transaction descriptions are included in the searchable set since that data is real. |

**Every mock module exports the same async function shape a real API client would**
(e.g. `getSavingsPots(customerId: string): Promise<Pot[]>`), called only through a
`hooks/useX.ts` React Query hook. A component importing `lib/mock/pots` directly, instead
of `hooks/useSavingsPots`, is a code-review-blocking mistake — this is the dependency-
inversion boundary the whole mock/real split depends on.

## 5. Component design

- **`AppShell`**: sidebar (static nav icons — Overview, Accounts, Transactions, Analytics,
  Cards, Settings; only Overview is wired to a page) + header (greeting, `SmartSearch`,
  `AlertsDropdown`).
- **`DashboardWidget`**: every widget below renders inside this shell, which provides: a
  title bar, a hide/show toggle and drag handle (visible only in "Customize" mode), and a
  React Query error boundary so one widget's fetch failure shows an inline retry state
  instead of crashing the page.
- **`AccountSummaryCards`**: one card per demo account — balance, and (if more than one
  demo account exists) a simple total. No fabricated account-type tabs.
- **`CashFlowChart`**: Recharts bar chart, period toggle (week/month/year), computed from
  real postings as described in §4.
- **`SpendingByCategoryChart`**: Recharts donut + legend, mock-categorized real postings.
  Clicking a slice opens a Radix `Dialog`/drawer listing that category's real transactions
  — this is the progressive-disclosure requirement, implemented as an in-page drawer, not
  a route change, to keep the dashboard feeling like one screen with drill-down.
- **`SavingsPotsWidget`**: list of mock pots, each with a progress bar (`current/target`),
  an "Add pot" button that opens a form writing to local state only (not persisted beyond
  the session — persisting pots is backend work, out of scope).
- **`CardManagementWidget`**: one mock card preview, freeze/unfreeze toggle (local state),
  spend-limit indicator (static).
- **`RecentTransactionsWidget`**: latest N real postings, each annotated with its mock
  category for an icon, "View all" opens the same drawer as the category drill-down.
- **`SmartSearch`**: `cmdk`-based palette (triggered from header or `Cmd/Ctrl+K`),
  searching mock recipients/actions plus real transaction descriptions.
- **`AlertsDropdown` / `AlertBanner`**: mock alerts list; the low-balance alert's condition
  is evaluated against the real account balance.

## 6. State, persistence, and error handling

- Dashboard widget order and visibility: `useDashboardLayout` hook, backed by
  `localStorage`, keyed per (mock) demo customer id. No backend persistence (out of scope
  — this is a personal UI preference, not ledger data).
- Server state (accounts, postings): TanStack Query, default `staleTime` a few seconds
  (dashboard data should feel fresh without refetching on every render).
- Mock data: also goes through TanStack Query (with an artificial small delay in the mock
  functions) so every widget has a real, consistent loading-skeleton state to design for —
  not an instant synchronous return that hides what the loading UI looks like.
- Errors: each `DashboardWidget` shows an inline "Couldn't load this — Retry" state scoped
  to that widget; a failure in one widget never affects the others.

## 7. Seeding demo data

A small script (`scripts/seed-demo.ts` in `ledger-service`, read-only to this frontend
build) creates 1–2 demo accounts via the existing `POST /accounts` and `POST /transfers`
endpoints and prints their ids. Those ids are pasted into `moneypurse-web/lib/demo-accounts.ts`
as a constant. This is a manual, one-time step documented in the frontend's README — not an
automated part of the frontend build, and not a change to `ledger-service` itself beyond
one new script file that calls existing, already-tested endpoints.

## 8. Testing

- `lib/format.ts` (currency/date formatting): unit tests.
- `lib/mock/categorize.ts` (keyword categorization): unit tests covering the keyword list
  and the "Other" fallback.
- `hooks/useDashboardLayout.ts` (localStorage persistence, reorder/hide logic): unit tests
  with a mocked `localStorage`.
- Component rendering/visual correctness: verified manually in the browser against the
  reference image, not automated in this build (see §1, out of scope).

## 9. Risks / things that could change the plan

- `ledger-service`'s CORS configuration has not been set up for a browser client — the
  implementation plan must include adding CORS headers (or a Next.js API-route proxy) so
  `moneypurse-web` can call it from the browser. This is a small, necessary backend-adjacent
  change (CORS config only, no endpoint/behavior change) and is called out here so it isn't
  missed during planning.
- Recharts' default theming is light-mode; the implementation plan should budget time for
  restyling its chart elements (axes, tooltips, legend) to the dark palette — this is normal
  but not zero-effort.
