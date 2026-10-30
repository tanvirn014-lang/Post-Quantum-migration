# MoneyPurse Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MoneyPurse web dashboard — a single authenticated page implementing the six required UX patterns (customizable layout, progressive-disclosure spending insights, goal-oriented savings pots, contextual card controls, smart search, contextual alerts) — as a Next.js app that reads real account/transaction data from `ledger-service` and mocks everything the backend doesn't yet model.

**Architecture:** Next.js App Router SPA-style app (`moneypurse-web/`, sibling to `ledger-service/`). Components never fetch data directly — they call `hooks/useX` hooks built on TanStack Query, which internally call either `lib/api/ledger-client.ts` (real) or `lib/mock/*` (mocked), both exposing identical async shapes. Pure computation (currency formatting, categorization, cash-flow/category aggregation, low-balance check) lives in small standalone, unit-tested functions under `lib/`, never inline in a component.

**Tech Stack:** Next.js (App Router) + React + TypeScript + Tailwind CSS, TanStack Query, Radix UI primitives, Recharts, cmdk, @dnd-kit/core.

**Spec:** [docs/superpowers/specs/2026-10-30-moneypurse-dashboard-design.md](../specs/2026-10-30-moneypurse-dashboard-design.md)

## Global Constraints

- Brand name is **MoneyPurse** everywhere in UI copy (header, page title, favicon alt text).
- Currency is **BDT** throughout; money crosses any API boundary as a **decimal string** in minor units (poisha), matching `ledger-service`'s existing wire format exactly — never a JS `number`.
- `ledger-service` runs on port **3000** (its existing default). The Next.js dev server runs on port **3100** (`next dev -p 3100`) to avoid colliding with it. The frontend reads the backend's base URL from `NEXT_PUBLIC_LEDGER_API_URL`, defaulting to `http://localhost:3000`.
- Every write call to `ledger-service` (transfers) sends an `Idempotency-Key` header, per that service's existing contract.
- **Components never import `lib/api/*` or `lib/mock/*` directly** — only through a `hooks/useX` hook. This is the dependency-inversion boundary the real/mock split depends on; violating it is treated as a defect, not a style nit.
- Test runner is **Node's built-in test runner (`node --test`) against `tsc`-compiled output, not Vitest** — not what the spec names, but the plan corrects it here for a concrete reason: this exact sandbox cannot spawn the native `esbuild` subprocess Vitest depends on (confirmed and documented while building `ledger-service` — see its README's "A note on the toolchain" section), and `tsc` + `node --test` is the already-proven working substitute in this codebase. React Testing Library is still used for component/hook tests; only the runner underneath it changes. Tests needing a DOM use `jsdom` (a pure-JS package, no native binary) loaded via a setup file.
- Strict TypeScript (`strict: true`), matching `ledger-service`'s `tsconfig.json`.

## Review Focus

- **Zero or negative account balance**: a brand-new demo account (0 balance) or an overdrawn one must render as valid states, not blank/broken cards. → Task 2 (`formatCurrency` zero/negative-amount tests) and Task 12 (`isLowBalance`'s negative-balance test) — together these are the only two places balance values are transformed before display, so correctness there is what makes Task 13's `AccountSummaryCards` safe for any balance.
- **A transaction description matching no category keyword**: must fall back to `"Other"`, never throw or render blank. → Task 7.
- **`localStorage` unavailable or holding corrupt JSON** (private browsing, a prior schema version): `useDashboardLayout` must fall back to the default widget order/visibility, not crash the dashboard. → Task 9.
- **One widget's data fetch fails**: it must show an inline retry state without affecting sibling widgets. → Task 11.
- **Money crossing the API boundary as the wrong type** (a JS `number` instead of a minor-units string) when posting a transfer: the easiest way to silently corrupt an amount. → Task 4.

---

## Task 1: Project scaffold and dark theme tokens

**Files:**
- Create: `moneypurse-web/package.json`, `moneypurse-web/tsconfig.json`, `moneypurse-web/next.config.ts`, `moneypurse-web/tailwind.config.ts`, `moneypurse-web/postcss.config.mjs`
- Create: `moneypurse-web/app/layout.tsx`, `moneypurse-web/app/page.tsx`, `moneypurse-web/app/globals.css`
- Create: `moneypurse-web/.env.local.example`
- Create: `moneypurse-web/README.md`

**Interfaces:**
- Produces: Tailwind theme tokens consumed by every later component — `bg-surface-base`, `bg-surface-raised`, `bg-surface-overlay` (three dark layers), `text-primary`, `text-muted`, `border-subtle`, and `accent` (brand accent color, chosen during this task — pick one consistent hue, e.g. a warm orange/amber, and use it for every primary action/highlight in later tasks). Defined as CSS variables in `globals.css` and wired into `tailwind.config.ts`'s `theme.extend.colors`.
- Produces: `app/page.tsx` redirects to `/dashboard` (the page itself is created in Task 13; this task's `page.tsx` just needs the redirect to compile — a `redirect("/dashboard")` from `next/navigation` is enough even before the target exists, Next.js resolves it at request time).

- [ ] **Step 1: Scaffold the project**

Run `npx create-next-app@latest moneypurse-web --typescript --tailwind --app --no-src-dir --import-alias "@/*"` from the workspace root, answering "No" to ESLint if prompted (not part of this plan's scope) and ordering is otherwise create-next-app's defaults.

- [ ] **Step 2: Verify the scaffold runs**

Run: `cd moneypurse-web && npm run dev -- -p 3100`
Expected: server starts, `http://localhost:3100` serves the default Next.js starter page without error. Stop the server once confirmed (this proves Next.js's SWC compiler works in this sandbox before anything else is built on top of it).

- [ ] **Step 3: Define the dark theme tokens**

In `app/globals.css`, under `:root`, define CSS variables: `--surface-base`, `--surface-raised`, `--surface-overlay`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent` (exact hex values are this task's call — pick a cohesive dark fintech palette; background layers should be distinguishably different dark grays, not near-identical). In `tailwind.config.ts`, map `theme.extend.colors` to `var(--surface-base)` etc. so later files use `bg-surface-base` rather than raw hex.

- [ ] **Step 4: Wire the redirect and brand name**

In `app/page.tsx`: a server component that calls `redirect("/dashboard")`.
In `app/layout.tsx`: set `<title>MoneyPurse</title>` via the `metadata` export (`title: "MoneyPurse"`), apply `bg-surface-base text-primary` to `<body>`.

- [ ] **Step 5: Add env example and README stub**

`.env.local.example`:
```
NEXT_PUBLIC_LEDGER_API_URL=http://localhost:3000
```
`README.md`: one paragraph stating this is MoneyPurse's web dashboard, that it requires `ledger-service` running separately on port 3000 with demo accounts seeded (link forward to Task 5's seed step), and the two run commands (`npm install`, `npm run dev -- -p 3100`). This file is appended to by later tasks (5, 18) rather than rewritten.

- [ ] **Step 6: Commit**

```bash
git add moneypurse-web
git commit -m "chore: scaffold moneypurse-web with dark theme tokens"
```

---

## Task 2: Currency and date formatting

**Files:**
- Create: `moneypurse-web/lib/format.ts`
- Test: `moneypurse-web/tests/lib/format.test.ts`

**Interfaces:**
- Produces: `formatCurrency(minorUnits: string, currency: string): string` — e.g. `formatCurrency("523000", "BDT")` → `"৳5,230.00"`.
- Produces: `formatRelativeDate(iso: string, now?: Date): string` — e.g. an ISO timestamp 2 hours before `now` → `"2 hours ago"`; more than 7 days before `now` → the date formatted as `"Jan 5, 2026"`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatRelativeDate } from "../../lib/format.js";

test("formatCurrency renders BDT minor units as a taka amount with the symbol", () => {
  assert.strictEqual(formatCurrency("523000", "BDT"), "৳5,230.00");
});

test("formatCurrency handles zero", () => {
  assert.strictEqual(formatCurrency("0", "BDT"), "৳0.00");
});

test("formatCurrency handles a negative amount", () => {
  assert.strictEqual(formatCurrency("-150000", "BDT"), "-৳1,500.00");
});

test("formatRelativeDate renders a timestamp under a day old as hours ago", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const twoHoursAgo = new Date("2026-10-30T10:00:00Z").toISOString();
  assert.strictEqual(formatRelativeDate(twoHoursAgo, now), "2 hours ago");
});

test("formatRelativeDate renders a timestamp over 7 days old as a calendar date", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const old = new Date("2026-01-05T12:00:00Z").toISOString();
  assert.strictEqual(formatRelativeDate(old, now), "Jan 5, 2026");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build:tests && node --test dist-tests/lib/format.test.js` (see Task 1's `package.json` — this task also adds the `"test"` and `"build:tests"` npm scripts, modeled on `ledger-service/package.json`'s `"build"`/`"test"` scripts: a `tsconfig.tests.json` compiling `lib/**/*.ts`, `hooks/**/*.ts`, `components/**/*.tsx`, and `tests/**/*.ts(x)` to `dist-tests/`, then `node --test dist-tests`. Unlike `ledger-service`, this `tsconfig.tests.json` must set `"jsx": "react-jsx"` from the start — Task 2's own tests don't use JSX, but Tasks 8 and 11's do, and the config shouldn't need revisiting when they arrive.)
Expected: FAIL — `format.ts` does not exist.

- [ ] **Step 3: Implement `formatCurrency` and `formatRelativeDate` in `lib/format.ts`**

`formatCurrency`: convert the minor-units string to a `bigint`, divide into whole/fractional taka (2 decimal places, BDT has no smaller unit in practice here), format the integer part with comma grouping, prefix `"৳"` (after the `-` sign for negative amounts, per the test above).
`formatRelativeDate`: parse both arguments to `Date`, compute the difference; under 1 hour → `"N minutes ago"`; under 24 hours → `"N hours ago"`; under 7 days → `"N days ago"`; otherwise → `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)`. `now` defaults to `new Date()` when not passed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build:tests && node --test dist-tests/lib/format.test.js`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add moneypurse-web/lib/format.ts moneypurse-web/tests/lib/format.test.ts moneypurse-web/package.json moneypurse-web/tsconfig.tests.json
git commit -m "feat: add BDT currency and relative date formatting"
```

---

## Task 3: API types mirroring ledger-service's DTOs

**Files:**
- Create: `moneypurse-web/lib/api/types.ts`

**Interfaces:**
- Produces: `Account { id: string; ownerCustomerId: string; currency: string; status: "active" | "frozen" | "closed"; balanceMinorUnits: string; allowOverdraft: boolean; createdAt: string }`
- Produces: `Transaction { id: string; idempotencyKey: string; description: string; status: "posted" | "reversed"; postedAt: string; metadata: Record<string, unknown> }`
- Produces: `Posting { id: string; transactionId: string; accountId: string; amountMinorUnits: string; currency: string }`
- Produces: `ApiError { error: { code: string; message: string } }`

No test for this task — it is type declarations only, copied field-for-field from `ledger-service/src/http/dto.ts`'s `toAccountDTO`/`toTransactionDTO`/`toPostingDTO`. Later tasks' tests exercise these types through the functions that use them.

- [ ] **Step 1: Write the types in `lib/api/types.ts`** exactly as listed above.

- [ ] **Step 2: Commit**

```bash
git add moneypurse-web/lib/api/types.ts
git commit -m "feat: add API types mirroring ledger-service DTOs"
```

---

## Task 4: Ledger API client

**Files:**
- Create: `moneypurse-web/lib/api/ledger-client.ts`
- Test: `moneypurse-web/tests/lib/api/ledger-client.test.ts`

**Interfaces:**
- Consumes: `Account`, `Transaction`, `Posting` from Task 3.
- Produces: `getAccount(accountId: string): Promise<Account>` — `GET {baseUrl}/accounts/:id`, throws `Error` with the response's `error.message` on non-2xx.
- Produces: `listPostings(accountId: string, limit?: number): Promise<Posting[]>` — `GET {baseUrl}/accounts/:id/postings?limit=N`.
- Produces: `postTransfer(input: { idempotencyKey: string; fromAccountId: string; toAccountId: string; amountMinorUnits: string; currency: string; description: string }): Promise<Transaction>` — `POST {baseUrl}/transfers` with header `Idempotency-Key: input.idempotencyKey` and JSON body `{ fromAccountId, toAccountId, amountMinorUnits, currency, description }` (note: `amountMinorUnits` stays a string end to end — the function signature itself forbids the Review Focus risk of passing a `number`).
- Produces: `baseUrl` read once from `process.env.NEXT_PUBLIC_LEDGER_API_URL ?? "http://localhost:3000"`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { getAccount, listPostings, postTransfer } from "../../../lib/api/ledger-client.js";

test("getAccount calls GET /accounts/:id and returns the parsed account", async () => {
  const fetchMock = mock.fn(async () => new Response(JSON.stringify({ id: "acc_1", balanceMinorUnits: "500" }), { status: 200 }));
  globalThis.fetch = fetchMock;
  const account = await getAccount("acc_1");
  assert.strictEqual(fetchMock.mock.calls[0].arguments[0], "http://localhost:3000/accounts/acc_1");
  assert.strictEqual(account.balanceMinorUnits, "500");
});

test("listPostings includes the limit query param when provided", async () => {
  const fetchMock = mock.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
  globalThis.fetch = fetchMock;
  await listPostings("acc_1", 10);
  assert.strictEqual(fetchMock.mock.calls[0].arguments[0], "http://localhost:3000/accounts/acc_1/postings?limit=10");
});

test("postTransfer sends the Idempotency-Key header and keeps amountMinorUnits as a string", async () => {
  const fetchMock = mock.fn(async () => new Response(JSON.stringify({ id: "txn_1" }), { status: 201 }));
  globalThis.fetch = fetchMock;
  await postTransfer({
    idempotencyKey: "key-1",
    fromAccountId: "acc_1",
    toAccountId: "acc_2",
    amountMinorUnits: "1000",
    currency: "BDT",
    description: "test",
  });
  const [, init] = fetchMock.mock.calls[0].arguments;
  assert.strictEqual(init.headers["Idempotency-Key"], "key-1");
  const body = JSON.parse(init.body);
  assert.strictEqual(typeof body.amountMinorUnits, "string");
  assert.strictEqual(body.amountMinorUnits, "1000");
});

test("getAccount throws the backend's error message on a non-2xx response", async () => {
  globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({ error: { code: "ACCOUNT_NOT_FOUND", message: "nope" } }), { status: 404 }));
  await assert.rejects(() => getAccount("missing"), /nope/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build:tests && node --test dist-tests/lib/api/ledger-client.test.js`
Expected: FAIL — `ledger-client.ts` does not exist.

- [ ] **Step 3: Implement the three functions in `lib/api/ledger-client.ts`**

Each calls `fetch`, checks `res.ok`, parses JSON; on failure, parses the body as `ApiError` and throws `new Error(body.error.message)`. Use the global `fetch` (Node 26 and the browser both provide it — no fetch library dependency).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build:tests && node --test dist-tests/lib/api/ledger-client.test.js`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add moneypurse-web/lib/api/ledger-client.ts moneypurse-web/tests/lib/api/ledger-client.test.ts
git commit -m "feat: add ledger-service API client"
```

---

## Task 5: CORS on ledger-service + demo account seed script

**Files:**
- Modify: `ledger-service/src/http/server.ts` (add CORS)
- Modify: `ledger-service/package.json` (add `@fastify/cors` dependency)
- Create: `ledger-service/tests/http/cors.test.ts`
- Create: `ledger-service/scripts/seed-demo.ts`
- Create: `moneypurse-web/lib/demo-accounts.ts`
- Modify: `moneypurse-web/README.md` (append the seed step)

**Interfaces:**
- Produces (ledger-service): `buildServer` now registers `@fastify/cors` with `origin: true` in non-test environments (keep it permissive — this is a local dev tool, not a deployed service yet) — or `false`/omitted in tests, matching the existing `BuildServerOptions` pattern (add a `cors?: boolean` option, default `true`, set to `false` in `tests/http/api.test.ts`'s `buildServer(service, { logger: false, cors: false })` call so the existing suite is unaffected).
- Produces (moneypurse-web): `demo-accounts.ts` exports `DEMO_CUSTOMER_ACCOUNTS: { primary: string; savings: string }` — two real account ids obtained by running the seed script once against a running `ledger-service` + Postgres.

- [ ] **Step 1: Write the failing CORS test**

```typescript
// ledger-service/tests/http/cors.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { LedgerService } from "../../src/app/ledger-service.js";
import { MemoryLedgerStore } from "../../src/adapters/memory/ledger-store.js";
import { buildServer } from "../../src/http/server.js";

describe("CORS", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = buildServer(new LedgerService(new MemoryLedgerStore()), { logger: false });
  });

  it("sets Access-Control-Allow-Origin on a cross-origin GET", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "http://localhost:3100" } });
    assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:3100");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `ledger-service/`): `npm test` with `tests/index.test.ts` temporarily importing `./http/cors.test.js` (add that import now, permanently — same pattern as the existing suite entries).
Expected: FAIL — no CORS headers set yet.

- [ ] **Step 3: Add `@fastify/cors` to `ledger-service`**

`npm install @fastify/cors` in `ledger-service/`. In `src/http/server.ts`, extend `BuildServerOptions` with `cors?: boolean` (default `true`), and when enabled, `app.register(cors, { origin: true })` before the route registrations.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test` (from `ledger-service/`)
Expected: PASS — the new CORS test, plus all 35 existing tests still pass (this is the regression check for touching shared server-setup code).

- [ ] **Step 5: Commit**

```bash
git add ledger-service/src/http/server.ts ledger-service/package.json ledger-service/package-lock.json ledger-service/tests/http/cors.test.ts ledger-service/tests/index.test.ts
git commit -m "feat: enable CORS on ledger-service for the web frontend"
```

- [ ] **Step 6: Write the seed script**

`ledger-service/scripts/seed-demo.ts`: a small script (same CLI-entry pattern as `src/adapters/postgres/migrate.ts` — `createPool()`, do the work, `pool.end()`) that creates one customer id (`randomUUID()`), one `allowOverdraft: true` "primary" account and one `allowOverdraft: false` "savings" account via direct calls to `PostgresLedgerStore` (import it directly — this script talks to the store, not over HTTP, since it's a one-time operator tool), posts a transfer of `500000` minor units (৳5,000) from primary to savings so both have a nonzero balance to look at, and `console.log`s both account ids clearly labeled (`primary: acc_...`, `savings: acc_...`).

- [ ] **Step 7: Run the seed script against the local Postgres**

Run: `DATABASE_URL=postgres://ledger:ledger@localhost:5432/ledger npx tsx ledger-service/scripts/seed-demo.ts` (or compile+run with `node`, matching this project's established toolchain — no new runtime dependency either way: write it as a `.ts` file compiled by the existing `tsconfig.json`, run via `node dist/scripts/seed-demo.js` after `npm run build`)
Expected: prints two real account ids.

- [ ] **Step 8: Paste the printed ids into `moneypurse-web/lib/demo-accounts.ts`**

```typescript
export const DEMO_CUSTOMER_ACCOUNTS = {
  primary: "acc_<paste the real id>",
  savings: "acc_<paste the real id>",
};
```

- [ ] **Step 9: Append the seed step to `moneypurse-web/README.md`**

One short section: "Before running the dashboard, seed demo data: `cd ledger-service && npm run build && node dist/scripts/seed-demo.js`, then copy the two printed ids into `lib/demo-accounts.ts`."

- [ ] **Step 10: Commit**

```bash
git add ledger-service/scripts/seed-demo.ts moneypurse-web/lib/demo-accounts.ts moneypurse-web/README.md
git commit -m "feat: add demo account seed script and wire its output into the frontend"
```

---

## Task 6: React Query provider setup

**Files:**
- Create: `moneypurse-web/app/providers.tsx`
- Modify: `moneypurse-web/app/layout.tsx`

**Interfaces:**
- Produces: `Providers` component wrapping children in a `QueryClientProvider` with a `QueryClient` configured with `defaultOptions.queries.staleTime: 5000` (per spec §6 — "a few seconds").

No test — this is framework wiring with no branching logic. Verified in Task 13 when the first real page renders through it.

- [ ] **Step 1: Create `app/providers.tsx`**

`"use client"` component instantiating one `QueryClient` (via `useState` so it isn't recreated on every render) and rendering `<QueryClientProvider client={client}>{children}</QueryClientProvider>`.

- [ ] **Step 2: Wrap `app/layout.tsx`'s children in `<Providers>`**

- [ ] **Step 3: Verify the dev server still boots**

Run: `npm run dev -- -p 3100`, load `http://localhost:3100`.
Expected: redirects to `/dashboard` (404 is fine/expected until Task 13 creates that page — confirm no *runtime error*, just Next's not-found page).

- [ ] **Step 4: Commit**

```bash
git add moneypurse-web/app/providers.tsx moneypurse-web/app/layout.tsx
git commit -m "feat: add React Query provider"
```

---

## Task 7: Mock data modules and category guesser

**Files:**
- Create: `moneypurse-web/lib/mock/pots.ts`, `moneypurse-web/lib/mock/cards.ts`, `moneypurse-web/lib/mock/alerts.ts`, `moneypurse-web/lib/mock/search.ts`
- Create: `moneypurse-web/lib/mock/categorize.ts`
- Test: `moneypurse-web/tests/lib/mock/categorize.test.ts`

**Interfaces:**
- Produces: `Pot { id: string; name: string; targetMinorUnits: string; currentMinorUnits: string; currency: string }` and `getSavingsPots(customerId: string): Promise<Pot[]>` (3 static fixtures, e.g. "Emergency Fund", "Vacation", "New Laptop").
- Produces: `Card { id: string; last4: string; brand: "visa" | "mastercard"; frozen: boolean; spendLimitMinorUnits: string }` and `getCards(customerId: string): Promise<Card[]>` (1 static fixture).
- Produces: `Alert { id: string; kind: "low_balance" | "upcoming_bill" | "unusual_spending"; message: string; createdAt: string }` and `getAlerts(customerId: string): Promise<Alert[]>` (2 static fixtures: an upcoming-bill and an unusual-spending alert — the low-balance alert is computed for real in Task 12, not stored here).
- Produces: `SearchSuggestion { id: string; label: string; type: "recipient" | "action" }` and `getSearchSuggestions(query: string): Promise<SearchSuggestion[]>` (filters a static fixture list of ~6 recipients/actions by substring match on `label`).
- Produces: `categorize(description: string): string` — pure function, no I/O.
- All four `getX` functions `await new Promise(r => setTimeout(r, 300))` before returning, per spec §6 ("artificial small delay... so every widget has a real loading-skeleton state").

- [ ] **Step 1: Write the failing categorize tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize } from "../../../lib/mock/categorize.js";

test("categorizes a grocery-looking description", () => {
  assert.strictEqual(categorize("Shwapno Supermarket"), "Groceries");
});

test("categorizes a bKash transfer description", () => {
  assert.strictEqual(categorize("bKash Send Money"), "Transfer");
});

test("categorizes a rent-looking description", () => {
  assert.strictEqual(categorize("Monthly rent payment"), "Housing");
});

test("falls back to Other when nothing matches", () => {
  assert.strictEqual(categorize("xyz123"), "Other");
});

test("matching is case-insensitive", () => {
  assert.strictEqual(categorize("BKASH topup"), "Transfer");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build:tests && node --test dist-tests/lib/mock/categorize.test.js`
Expected: FAIL — `categorize.ts` does not exist.

- [ ] **Step 3: Implement `categorize` in `lib/mock/categorize.ts`**

A `Record<string, string[]>` mapping category name to lowercase keyword list (`Groceries: ["grocery", "supermarket", "shwapno"]`, `Transfer: ["bkash", "nagad", "transfer", "send money"]`, `Housing: ["rent", "housing"]`, plus 2-3 more categories of the implementer's choice covering common transaction types). Lowercase the input, return the first category whose any keyword is a substring match, else `"Other"`.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS, all 5.

- [ ] **Step 5: Implement the four mock data files** per the fixtures and delay described above. No tests (static data, no branching logic beyond what Step 1-4 already covers for categorize).

- [ ] **Step 6: Commit**

```bash
git add moneypurse-web/lib/mock
git commit -m "feat: add mock data sources and category guesser"
```

---

## Task 8: Real data hooks — accounts and transactions

**Files:**
- Create: `moneypurse-web/hooks/useAccounts.ts`, `moneypurse-web/hooks/useTransactions.ts`
- Test: `moneypurse-web/tests/hooks/useAccounts.test.tsx`

**Interfaces:**
- Consumes: `getAccount`, `listPostings` from Task 4; `DEMO_CUSTOMER_ACCOUNTS` from Task 5.
- Produces: `useAccount(accountId: string)` — thin `useQuery` wrapper, `queryKey: ["account", accountId]`, `queryFn: () => getAccount(accountId)`.
- Produces: `usePostings(accountId: string, limit?: number)` — `useQuery`, `queryKey: ["postings", accountId, limit]`, `queryFn: () => listPostings(accountId, limit)`.
- Both return the standard `UseQueryResult` shape (`data`, `isLoading`, `isError`, `refetch`) — nothing hook-specific added, since React Query's own shape is already exactly what `DashboardWidget` (Task 11) needs.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/hooks/useAccounts.test.tsx
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccount } from "../../hooks/useAccounts.js";

test("useAccount resolves with the account returned by the API", async () => {
  // Mock globalThis.fetch, not the ledger-client module's exports: real ES module
  // namespace objects are non-configurable, so mock.method() on an `import * as`
  // namespace does not reliably work (see Task 4, which establishes this same
  // fetch-mocking pattern for ledger-client.ts's own tests).
  globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({ id: "acc_1", balanceMinorUnits: "500" }), { status: 200 }));
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAccount("acc_1"), { wrapper });
  await waitFor(() => assert.strictEqual(result.current.isSuccess, true));
  assert.strictEqual(result.current.data?.balanceMinorUnits, "500");
});
```

This is the first test needing a DOM. Add `tests/setup.ts` (imported via `--import` on the `node --test` command in `package.json`'s `"test"` script, i.e. `node --import ./dist-tests/tests/setup.js --test dist-tests`) that installs `jsdom` globals (`import { JSDOM } from "jsdom"; const dom = new JSDOM(); globalThis.window = dom.window; globalThis.document = dom.window.document;` plus whatever `@testing-library/react` needs — `navigator`, etc., following `jsdom`'s documented global-registration recipe). Add `jsdom` and `@testing-library/react` and `@tanstack/react-query` as dependencies in this step.

- [ ] **Step 2: Run the test to verify it fails**

Expected: FAIL — `useAccounts.ts` does not exist.

- [ ] **Step 3: Implement `useAccount` and `usePostings` in their respective files**

- [ ] **Step 4: Run the test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add moneypurse-web/hooks/useAccounts.ts moneypurse-web/hooks/useTransactions.ts moneypurse-web/tests/hooks/useAccounts.test.tsx moneypurse-web/tests/setup.ts moneypurse-web/package.json
git commit -m "feat: add real-data hooks for accounts and transactions"
```

---

## Task 9: Dashboard layout persistence hook

**Files:**
- Create: `moneypurse-web/hooks/useDashboardLayout.ts`
- Test: `moneypurse-web/tests/hooks/useDashboardLayout.test.tsx`

**Interfaces:**
- Produces: `WIDGET_IDS` — a `const` array of the six widget ids in their default order: `["accounts", "cashflow", "spending", "pots", "cards", "transactions"]`.
- Produces: `useDashboardLayout()` returning `{ order: string[]; hidden: Set<string>; reorder(from: number, to: number): void; toggleHidden(id: string): void }`.
- Persists to `localStorage` key `"moneypurse.dashboard.layout.v1"` as `{ order: string[]; hidden: string[] }`. On missing or unparsable stored data, falls back to `{ order: WIDGET_IDS, hidden: [] }` — never throws.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/hooks/useDashboardLayout.test.tsx
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import { useDashboardLayout, WIDGET_IDS } from "../../hooks/useDashboardLayout.js";

beforeEach(() => { globalThis.localStorage.clear(); });

test("defaults to WIDGET_IDS in order with nothing hidden when storage is empty", () => {
  const { result } = renderHook(() => useDashboardLayout());
  assert.deepStrictEqual(result.current.order, WIDGET_IDS);
  assert.strictEqual(result.current.hidden.size, 0);
});

test("falls back to the default when localStorage holds corrupt JSON", () => {
  globalThis.localStorage.setItem("moneypurse.dashboard.layout.v1", "{not json");
  const { result } = renderHook(() => useDashboardLayout());
  assert.deepStrictEqual(result.current.order, WIDGET_IDS);
});

test("toggleHidden adds and removes an id from the hidden set, and persists it", () => {
  const { result } = renderHook(() => useDashboardLayout());
  act(() => result.current.toggleHidden("cards"));
  assert.strictEqual(result.current.hidden.has("cards"), true);
  const stored = JSON.parse(globalThis.localStorage.getItem("moneypurse.dashboard.layout.v1")!);
  assert.deepStrictEqual(stored.hidden, ["cards"]);
  act(() => result.current.toggleHidden("cards"));
  assert.strictEqual(result.current.hidden.has("cards"), false);
});

test("reorder moves an id from one index to another and persists it", () => {
  const { result } = renderHook(() => useDashboardLayout());
  act(() => result.current.reorder(0, 2));
  assert.strictEqual(result.current.order[2], WIDGET_IDS[0]);
});
```

`jsdom`'s `window` provides a real `localStorage` implementation; `globalThis.localStorage` is assigned to it in `tests/setup.ts` (extend Task 8's setup file with `globalThis.localStorage = dom.window.localStorage;`).

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — hook does not exist.

- [ ] **Step 3: Implement `useDashboardLayout`**

`useState` initialized lazily from `localStorage.getItem(...)`, wrapped in `try/catch` returning the default on any parse failure (satisfies the Review Focus item). `reorder`/`toggleHidden` update state and `localStorage.setItem` in the same call.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS, all 4.

- [ ] **Step 5: Commit**

```bash
git add moneypurse-web/hooks/useDashboardLayout.ts moneypurse-web/tests/hooks/useDashboardLayout.test.tsx moneypurse-web/tests/setup.ts
git commit -m "feat: add dashboard layout persistence hook"
```

---

## Task 10: Mock-data hooks

**Files:**
- Create: `moneypurse-web/hooks/useSavingsPots.ts`, `moneypurse-web/hooks/useCards.ts`, `moneypurse-web/hooks/useAlerts.ts`, `moneypurse-web/hooks/useSearchSuggestions.ts`

**Interfaces:**
- Consumes: `getSavingsPots`, `getCards`, `getAlerts`, `getSearchSuggestions` from Task 7.
- Produces: `useSavingsPots(customerId: string)`, `useCards(customerId: string)`, `useAlerts(customerId: string)` — each a `useQuery` wrapper exactly like Task 8's hooks (same `UseQueryResult` shape, same pattern — this is why Task 8 and this task share no test duplication: the pattern is proven once, repeated by inspection here).
- Produces: `useSearchSuggestions(query: string)` — `useQuery` with `queryKey: ["search", query]`, `enabled: query.length > 0` (don't fire a query for an empty search box).

No new test: this task applies the exact pattern Task 8 already tested (a `useQuery` wrapper around an async function). Re-testing the same wrapper shape four more times would be the "transcript, not a plan" anti-pattern the self-review checks for — Task 8's test is the proof this pattern works, including with a mocked module.

- [ ] **Step 1: Implement all four hooks.**

- [ ] **Step 2: Commit**

```bash
git add moneypurse-web/hooks/useSavingsPots.ts moneypurse-web/hooks/useCards.ts moneypurse-web/hooks/useAlerts.ts moneypurse-web/hooks/useSearchSuggestions.ts
git commit -m "feat: add mock-data hooks for pots, cards, alerts, and search"
```

---

## Task 11: UI primitives and DashboardWidget shell

**Files:**
- Create: `moneypurse-web/components/ui/Card.tsx`, `Button.tsx`, `Badge.tsx`, `ProgressBar.tsx`, `Avatar.tsx`, `Drawer.tsx`, `Dropdown.tsx`
- Create: `moneypurse-web/components/dashboard/DashboardWidget.tsx`
- Test: `moneypurse-web/tests/components/dashboard/DashboardWidget.test.tsx`

**Interfaces:**
- Produces (ui primitives, Tailwind-only, no business logic):
  - `Card({ children, className? })` — a `bg-surface-raised rounded-xl` container.
  - `Button({ children, variant: "primary" | "secondary" | "ghost", ...buttonProps })`.
  - `Badge({ children, tone: "neutral" | "success" | "warning" | "danger" })`.
  - `ProgressBar({ value: number, max: number })` (0–100% fill bar).
  - `Avatar({ initials: string })`.
  - `Drawer({ open: boolean, onOpenChange: (open: boolean) => void, title: string, children })` — wraps `@radix-ui/react-dialog` styled as a right-side slide-over.
  - `Dropdown({ trigger: ReactNode, children })` — wraps `@radix-ui/react-dropdown-menu`.
- Consumes: `Card`, `Button` (for the retry state) from this same task; `useDashboardLayout`'s `hidden`/`toggleHidden` from Task 9 (passed in as props, not called internally — `DashboardWidget` is presentational, the page composing it in Task 13 owns the hook call).
- Produces: `DashboardWidget({ id: string, title: string, editMode: boolean, hidden: boolean, onToggleHidden: () => void, query: { isLoading: boolean; isError: boolean; refetch: () => void }, children: ReactNode })` — renders nothing when `hidden && !editMode`; renders a loading skeleton when `query.isLoading`; renders an inline "Couldn't load this — Retry" `Button` calling `query.refetch()` when `query.isError`; otherwise renders `children` inside a `Card`, with a hide-toggle control shown only when `editMode` is true.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/components/dashboard/DashboardWidget.test.tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardWidget } from "../../../components/dashboard/DashboardWidget.js";

test("shows a retry button on error, and calls refetch when clicked", () => {
  const refetch = () => { refetchCalled = true; };
  let refetchCalled = false;
  render(
    <DashboardWidget id="x" title="X" editMode={false} hidden={false} onToggleHidden={() => {}}
      query={{ isLoading: false, isError: true, refetch }}>
      <div>content</div>
    </DashboardWidget>
  );
  assert.ok(screen.getByText(/retry/i));
  fireEvent.click(screen.getByText(/retry/i));
  assert.strictEqual(refetchCalled, true);
});

test("renders nothing when hidden and not in edit mode", () => {
  const { container } = render(
    <DashboardWidget id="x" title="X" editMode={false} hidden={true} onToggleHidden={() => {}}
      query={{ isLoading: false, isError: false, refetch: () => {} }}>
      <div>content</div>
    </DashboardWidget>
  );
  assert.strictEqual(container.textContent, "");
});

test("renders children when not loading and not errored", () => {
  render(
    <DashboardWidget id="x" title="X" editMode={false} hidden={false} onToggleHidden={() => {}}
      query={{ isLoading: false, isError: false, refetch: () => {} }}>
      <div>content</div>
    </DashboardWidget>
  );
  assert.ok(screen.getByText("content"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement the ui primitives, then `DashboardWidget`** per the interfaces above.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS, all 3.

- [ ] **Step 5: Visually verify**

Not applicable yet — no page renders these until Task 13. Skip to commit (this is why `DashboardWidget`'s logic-bearing states are unit-tested here instead: there is no page to eyeball yet).

- [ ] **Step 6: Commit**

```bash
git add moneypurse-web/components/ui moneypurse-web/components/dashboard/DashboardWidget.tsx moneypurse-web/tests/components/dashboard/DashboardWidget.test.tsx
git commit -m "feat: add UI primitives and the DashboardWidget shell"
```

---

## Task 12: App shell — sidebar and header

**Files:**
- Create: `moneypurse-web/components/layout/Sidebar.tsx`, `moneypurse-web/components/layout/Header.tsx`, `moneypurse-web/components/layout/AppShell.tsx`
- Create: `moneypurse-web/lib/low-balance.ts`
- Test: `moneypurse-web/tests/lib/low-balance.test.ts`

**Interfaces:**
- Consumes: `Dropdown`, `Avatar` from Task 11.
- Produces: `isLowBalance(balanceMinorUnits: string, thresholdMinorUnits: string): boolean` — pure function, `true` when the balance is less than the threshold (both parsed as `bigint`).
- Produces: `Sidebar()` — static nav list (Overview active/highlighted, Accounts/Transactions/Analytics/Cards/Settings present but not linked to real routes — `href="#"` with `aria-disabled`, per spec §5 "only Overview is wired").
- Produces: `Header({ greeting: string, lowBalance: boolean })` — brand wordmark "moneypurse", greeting text, a `SmartSearch` placeholder slot (filled in Task 16 — render `children` or a named slot so Task 16 doesn't have to modify this file) and an `AlertsDropdown` placeholder slot the same way.
- Produces: `AppShell({ children })` — `<Sidebar />` + a main column with `<Header />` + `children`.

- [ ] **Step 1: Write the failing `isLowBalance` tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLowBalance } from "../../lib/low-balance.js";

test("true when balance is below the threshold", () => {
  assert.strictEqual(isLowBalance("500", "1000"), true);
});

test("false when balance equals the threshold", () => {
  assert.strictEqual(isLowBalance("1000", "1000"), false);
});

test("false when balance is above the threshold", () => {
  assert.strictEqual(isLowBalance("1500", "1000"), false);
});

test("true for a negative (overdrawn) balance against any positive threshold", () => {
  assert.strictEqual(isLowBalance("-100", "1000"), true);
});
```

- [ ] **Step 2: Run to verify failure, then implement `isLowBalance`, then verify it passes.**

- [ ] **Step 3: Implement `Sidebar`, `Header`, `AppShell`** per the interfaces above. No test (static layout markup; `isLowBalance`, the one piece of real logic this task introduces, is already covered).

- [ ] **Step 4: Commit**

```bash
git add moneypurse-web/components/layout moneypurse-web/lib/low-balance.ts moneypurse-web/tests/lib/low-balance.test.ts
git commit -m "feat: add app shell (sidebar, header) and low-balance check"
```

---

## Task 13: Dashboard page composition (no drag-and-drop yet)

**Files:**
- Create: `moneypurse-web/app/dashboard/page.tsx`
- Create: `moneypurse-web/components/dashboard/AccountSummaryCards.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 12), `DashboardWidget` (Task 11), `useAccount` (Task 8), `DEMO_CUSTOMER_ACCOUNTS` (Task 5), `formatCurrency` (Task 2).
- Produces: `AccountSummaryCards()` — calls `useAccount` for both demo accounts, renders a `Card` per account (label, `formatCurrency(balanceMinorUnits, currency)`), wrapped in its own `DashboardWidget`.
- Produces: `app/dashboard/page.tsx` — `"use client"` page rendering `<AppShell><AccountSummaryCards /></AppShell>` (the remaining five widgets are added in Tasks 14–17 and 19, each as one more `<DashboardWidget>` entry in this file — this task exists to get the end-to-end path (hook → real API → rendered taka amount) working and visually verified before building the rest on top of it).

- [ ] **Step 1: Implement `AccountSummaryCards` and `app/dashboard/page.tsx`.**

- [ ] **Step 2: Run the seeded stack end to end**

Run: `ledger-service` (`LEDGER_STORE=postgres DATABASE_URL=... npm start`, port 3000) and `moneypurse-web` (`npm run dev -- -p 3100`) together; open `http://localhost:3100`.
Expected: redirects to `/dashboard`, shows the sidebar/header shell and two account cards with real BDT balances matching what the seed script printed/transferred (one around ৳0 after funding itself, the other ৳5,000 — whichever direction Task 5's seed transfer went).

- [ ] **Step 3: Commit**

```bash
git add moneypurse-web/app/dashboard moneypurse-web/components/dashboard/AccountSummaryCards.tsx
git commit -m "feat: compose the dashboard page with real account balances"
```

---

## Task 14: Cash flow aggregation and chart

**Files:**
- Create: `moneypurse-web/lib/aggregate-cash-flow.ts`
- Create: `moneypurse-web/components/dashboard/CashFlowChart.tsx`
- Test: `moneypurse-web/tests/lib/aggregate-cash-flow.test.ts`
- Modify: `moneypurse-web/app/dashboard/page.tsx` (add the widget)

**Interfaces:**
- Consumes: `Posting` (Task 3), `usePostings` (Task 8).
- Produces: `aggregateCashFlow(postings: Posting[], period: "week" | "month" | "year", now?: Date): { label: string; income: number; expense: number }[]` — buckets postings by calendar period (week: last 7 days by day; month: last 30 days by week; year: last 12 months), summing positive `amountMinorUnits` as `income` and the absolute value of negative ones as `expense` (both returned as plain `number` major-units, since Recharts needs numbers — this is the one place a `bigint`-precision minor-units value is intentionally converted to a `number` for charting display only, never sent back to an API).
- Produces: `CashFlowChart()` — period toggle (`"week" | "month" | "year"` state), calls `usePostings` for the primary demo account, pipes through `aggregateCashFlow`, renders a Recharts `BarChart` (two `Bar`s: income/expense) styled with the dark palette tokens from Task 1, wrapped in its own `DashboardWidget`.

- [ ] **Step 1: Write the failing `aggregateCashFlow` tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateCashFlow } from "../../lib/aggregate-cash-flow.js";

const posting = (amountMinorUnits: string, daysAgo: number, now: Date) => ({
  id: "p", transactionId: "t", accountId: "a", currency: "BDT", amountMinorUnits,
  createdAt: new Date(now.getTime() - daysAgo * 86400000).toISOString(),
} as any);

test("buckets a week's postings by day, separating income and expense", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const postings = [posting("100000", 1, now), posting("-50000", 1, now)];
  const result = aggregateCashFlow(postings, "week", now);
  const day = result.find(r => r.income > 0 || r.expense > 0)!;
  assert.strictEqual(day.income, 1000);
  assert.strictEqual(day.expense, 500);
});

test("excludes postings older than the requested period", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const postings = [posting("100000", 400, now)];
  const result = aggregateCashFlow(postings, "week", now);
  assert.strictEqual(result.every(r => r.income === 0), true);
});

test("returns one bucket per day for the week period", () => {
  const result = aggregateCashFlow([], "week", new Date("2026-10-30T00:00:00Z"));
  assert.strictEqual(result.length, 7);
});
```

Note: these tests require `Posting` to carry a timestamp. The real `Posting` type (Task 3) mirrors `ledger-service`'s DTO, which does **not** currently expose `created_at` on postings (`toPostingDTO` omits it — see `ledger-service/src/http/dto.ts`). Before writing this task's implementation, add `createdAt: string` to `Posting` in `lib/api/types.ts` (Task 3) **and** add `createdAt: posting.created_at.toISOString()` to `toPostingDTO` in `ledger-service/src/http/dto.ts`, with a one-line addition to `ledger-service/tests/http/api.test.ts`'s existing transfer test asserting the returned posting has a `createdAt` field. This is a small, backward-compatible backend addition (adding a field, not changing one) — do it as part of this task's Step 1, not a separate task, since `CashFlowChart` cannot exist without it.

- [ ] **Step 2: Add `createdAt` to the real `Posting` DTO (backend)**

In `ledger-service/src/http/dto.ts`'s `toPostingDTO`, add `createdAt: posting.createdAt.toISOString()`. This requires `Posting` (the domain type, `ledger-service/src/domain/ledger.ts`) and both adapters' `mapPostingRow`/in-memory posting objects to already carry a timestamp — they don't yet. Add `createdAt: Date` to the domain `Posting` interface, set it to `new Date()` when `MemoryLedgerStore` creates a posting, select/map `created_at` in `PostgresLedgerStore`'s `mapPostingRow` (the column already exists in the schema, it's just not selected into the mapped object).

- [ ] **Step 3: Update `ledger-service`'s existing tests for the new field**

Add one assertion to the existing "transfers money end-to-end through the HTTP API" test (`ledger-service/tests/http/api.test.ts`) and its Postgres-integration counterpart: `assert.ok(fetchedTx.json().postings[0].createdAt)`.

- [ ] **Step 4: Run `ledger-service`'s full test suite**

Run (from `ledger-service/`): `npm run build && node --test dist/tests/index.test.js` (memory suite) and, if Postgres is up, with `DATABASE_URL` set.
Expected: PASS, all previously-35 tests plus the 2 new assertions (37 total).

- [ ] **Step 5: Commit the backend change separately**

```bash
git add ledger-service/src/domain/ledger.ts ledger-service/src/adapters ledger-service/src/http/dto.ts ledger-service/tests/http/api.test.ts ledger-service/tests/adapters
git commit -m "feat: expose posting createdAt timestamp over the API"
```

- [ ] **Step 6: Add `createdAt` to the frontend's `Posting` type (Task 3's file) and write/run/pass the `aggregateCashFlow` tests from Step 1**

- [ ] **Step 7: Implement `CashFlowChart` and add it to `app/dashboard/page.tsx`**

- [ ] **Step 8: Visually verify** in the browser against the reference image's cash-flow bar chart (dark-themed bars, period toggle works).

- [ ] **Step 9: Commit**

```bash
git add moneypurse-web/lib/aggregate-cash-flow.ts moneypurse-web/components/dashboard/CashFlowChart.tsx moneypurse-web/tests/lib/aggregate-cash-flow.test.ts moneypurse-web/lib/api/types.ts moneypurse-web/app/dashboard/page.tsx
git commit -m "feat: add cash flow aggregation and chart widget"
```

---

## Task 15: Spending-by-category aggregation, chart, and drill-down

**Files:**
- Create: `moneypurse-web/lib/aggregate-by-category.ts`
- Create: `moneypurse-web/components/dashboard/SpendingByCategoryChart.tsx`
- Test: `moneypurse-web/tests/lib/aggregate-by-category.test.ts`
- Modify: `moneypurse-web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `Posting` (Task 3), `categorize` (Task 7), `usePostings` (Task 8), `Drawer` (Task 11).
- Produces: `aggregateByCategory(postings: Posting[]): { category: string; totalMinorUnits: string; postings: Posting[] }[]` — groups negative (expense) postings by `categorize(posting's transaction description)`. Note: `Posting` itself has no `description` (that lives on `Transaction`) — this function takes a second parameter `descriptionsByTransactionId: Record<string, string>` built by the component from the transactions it already has, rather than fetching transactions per-posting. Final signature: `aggregateByCategory(postings: Posting[], descriptionsByTransactionId: Record<string, string>): {...}[]`.
- Produces: `SpendingByCategoryChart()` — Recharts `PieChart` (donut), clicking a slice opens `Drawer` listing that category's postings (amount via `formatCurrency`, description via the same lookup map), wrapped in `DashboardWidget`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateByCategory } from "../../lib/aggregate-by-category.js";

const posting = (amountMinorUnits: string, transactionId: string) => ({
  id: "p", transactionId, accountId: "a", currency: "BDT", amountMinorUnits,
} as any);

test("groups expense postings by category and sums their absolute amounts", () => {
  const postings = [posting("-50000", "t1"), posting("-30000", "t2")];
  const descriptions = { t1: "Shwapno Supermarket", t2: "Agora grocery" };
  const result = aggregateByCategory(postings, descriptions);
  const groceries = result.find(r => r.category === "Groceries")!;
  assert.strictEqual(groceries.totalMinorUnits, "80000");
  assert.strictEqual(groceries.postings.length, 2);
});

test("excludes income (positive) postings", () => {
  const postings = [posting("100000", "t1")];
  const result = aggregateByCategory(postings, { t1: "Salary" });
  assert.strictEqual(result.length, 0);
});

test("falls back to Other for an unmatched description", () => {
  const postings = [posting("-1000", "t1")];
  const result = aggregateByCategory(postings, { t1: "xyz123" });
  assert.strictEqual(result[0]!.category, "Other");
});
```

- [ ] **Step 2: Run to verify failure, implement `aggregateByCategory`, run to verify pass.**

- [ ] **Step 3: Implement `SpendingByCategoryChart`** and add it to `app/dashboard/page.tsx`. It needs transaction descriptions: fetch them via a small local loop calling the existing `getAccount`/transaction lookup is overkill — instead, extend `usePostings`'s consumer here to also accept the already-fetched postings' `transactionId`s is unnecessary complexity for v1; simplest correct option: this component receives its transaction descriptions by calling one new hook, `useTransactionDescriptions(transactionIds: string[])` in `hooks/useTransactions.ts` (added in this step), which calls `GET /transactions/:id` per unique id via `React Query`'s `useQueries` and reduces the results into the `Record<string, string>` shape `aggregateByCategory` expects.

- [ ] **Step 4: Visually verify** the donut chart and drill-down drawer against the reference image.

- [ ] **Step 5: Commit**

```bash
git add moneypurse-web/lib/aggregate-by-category.ts moneypurse-web/components/dashboard/SpendingByCategoryChart.tsx moneypurse-web/tests/lib/aggregate-by-category.test.ts moneypurse-web/hooks/useTransactions.ts moneypurse-web/app/dashboard/page.tsx
git commit -m "feat: add spending-by-category chart with transaction drill-down"
```

---

## Task 16: Savings pots, card management, recent transactions widgets

**Files:**
- Create: `moneypurse-web/components/dashboard/SavingsPotsWidget.tsx`, `moneypurse-web/components/dashboard/CardManagementWidget.tsx`, `moneypurse-web/components/dashboard/RecentTransactionsWidget.tsx`
- Modify: `moneypurse-web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `useSavingsPots`, `useCards` (Task 10), `usePostings` (Task 8), `categorize` (Task 7), `ProgressBar`, `Badge`, `Button`, `Drawer` (Task 11), `formatCurrency`/`formatRelativeDate` (Task 2).
- Produces: `SavingsPotsWidget()` — one `Card` per pot with `ProgressBar` (`current/target`), an "Add pot" `Button` opening a `Drawer` with a name+target form that appends to local component state only (not persisted — per spec §5).
- Produces: `CardManagementWidget()` — one `Card` previewing the mock card (masked `**** {last4}`), a freeze/unfreeze `Button` toggling local state (not calling any API — no card backend exists), a `Badge` showing the spend limit.
- Produces: `RecentTransactionsWidget()` — latest 5 postings from `usePostings` for the primary demo account, each row showing `categorize`'s guess as an icon/label, `formatCurrency`, `formatRelativeDate`; a "View all" `Button` opening the same `Drawer` pattern as Task 15's drill-down, unfiltered.

No new tests — each widget composes already-tested hooks/functions (`useSavingsPots`, `useCards`, `categorize`, `formatCurrency`, `formatRelativeDate`) with no new branching logic of its own; verified visually per spec §8.

- [ ] **Step 1: Implement all three widgets and add them to `app/dashboard/page.tsx`.**

- [ ] **Step 2: Visually verify** all three against the reference image (goal progress bars, card preview with freeze toggle, recent transaction list).

- [ ] **Step 3: Commit**

```bash
git add moneypurse-web/components/dashboard/SavingsPotsWidget.tsx moneypurse-web/components/dashboard/CardManagementWidget.tsx moneypurse-web/components/dashboard/RecentTransactionsWidget.tsx moneypurse-web/app/dashboard/page.tsx
git commit -m "feat: add savings pots, card management, and recent transactions widgets"
```

---

## Task 17: Smart search

**Files:**
- Create: `moneypurse-web/components/search/SmartSearch.tsx`
- Modify: `moneypurse-web/components/layout/Header.tsx` (fill the slot from Task 12)

**Interfaces:**
- Consumes: `useSearchSuggestions` (Task 10), `usePostings` (Task 8, for including real transaction descriptions in the searchable set per spec §4's last row).
- Produces: `SmartSearch()` — a `cmdk` `Command` palette triggered by a header button or `Cmd/Ctrl+K` (global keydown listener), showing `useSearchSuggestions(query)` results plus any real posting whose description matches `query` (simple case-insensitive substring match, inline in this component — not worth its own tested module, since `cmdk` already does its own internal filtering/scoring on top of whatever list is passed in).

No new test — `cmdk`'s own filtering is the tested behavior that matters here, and is cmdk's responsibility, not this plan's. Verified visually (search opens, suggestions and real transactions both appear, selecting a result does something reasonable — e.g. closes the palette).

- [ ] **Step 1: Implement `SmartSearch` and wire it into `Header`.**

- [ ] **Step 2: Visually verify**: open the palette, type a query matching both a mock recipient and a real transaction description, confirm both appear.

- [ ] **Step 3: Commit**

```bash
git add moneypurse-web/components/search/SmartSearch.tsx moneypurse-web/components/layout/Header.tsx
git commit -m "feat: add smart search with suggestions"
```

---

## Task 18: Alerts dropdown and banner

**Files:**
- Create: `moneypurse-web/components/alerts/AlertsDropdown.tsx`, `moneypurse-web/components/alerts/AlertBanner.tsx`
- Modify: `moneypurse-web/components/layout/Header.tsx` (fill the alerts slot), `moneypurse-web/app/dashboard/page.tsx` (render `AlertBanner` above the widget grid)

**Interfaces:**
- Consumes: `useAlerts` (Task 10), `useAccount` (Task 8), `isLowBalance` (Task 12), `Dropdown`, `Badge` (Task 11).
- Produces: `AlertsDropdown()` — bell icon button opening a `Dropdown` listing `useAlerts`'s mock alerts, plus a synthesized low-balance alert (message `"Your balance is below ৳<threshold>"`) prepended when `isLowBalance(primary account's balance, "100000")` (threshold: ৳1,000 — this task's call, document it as a code comment since it's not in the spec).
- Produces: `AlertBanner()` — renders the same low-balance condition as an inline dismissible banner at the top of the dashboard (dismissal is local component state, resets on reload — no persistence needed for a demo alert).

No new test — the only logic (`isLowBalance`) is already tested in Task 12; this task is composition and presentation.

- [ ] **Step 1: Implement both components and wire them in.**

- [ ] **Step 2: Visually verify**: with the seeded demo accounts' balances, confirm the low-balance alert appears or doesn't, correctly, based on whether a demo balance is actually under ৳1,000 (if neither seeded account is under threshold, temporarily lower the threshold locally to confirm the banner renders, then restore ৳1,000 — note the result in the commit message, don't leave the lowered value in).

- [ ] **Step 3: Commit**

```bash
git add moneypurse-web/components/alerts moneypurse-web/components/layout/Header.tsx moneypurse-web/app/dashboard/page.tsx
git commit -m "feat: add alerts dropdown and low-balance banner"
```

---

## Task 19: Drag-to-reorder and edit mode

**Files:**
- Modify: `moneypurse-web/app/dashboard/page.tsx` (wire `useDashboardLayout`, add `@dnd-kit/core` sorting, add an "Customize" edit-mode toggle button)

**Interfaces:**
- Consumes: `useDashboardLayout` (Task 9), `@dnd-kit/core`'s `DndContext`/`SortableContext` (and `@dnd-kit/sortable`, added as a dependency in this task).
- Produces: nothing new for later tasks — this is the final page-level integration task. `app/dashboard/page.tsx` now: calls `useDashboardLayout()` once; renders a header "Customize" `Button` toggling local `editMode` state; wraps the six widgets (now all present from Tasks 13–18) in `DndContext`/`SortableContext` keyed by `order`, passing each `DashboardWidget` its `hidden`/`onToggleHidden` from the hook; `onDragEnd` calls `reorder(oldIndex, newIndex)`.

- [ ] **Step 1: Implement the edit-mode toggle and drag-and-drop wiring.**

- [ ] **Step 2: Visually verify**: toggle "Customize", hide a widget, reload the page, confirm it's still hidden (localStorage persistence); drag a widget to a new position, reload, confirm the new order persists.

- [ ] **Step 3: Commit**

```bash
git add moneypurse-web/app/dashboard/page.tsx moneypurse-web/package.json
git commit -m "feat: add customizable dashboard layout (drag-to-reorder, hide widgets)"
```

---

## Task 20: Final polish and README

**Files:**
- Modify: `moneypurse-web/README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Walk the full reference-image comparison once more** across all six widgets together on one screen; fix any obviously mismatched spacing/color (this task's judgment call — the spec does not require pixel-parity, only the same mood/layout family).

- [ ] **Step 2: Finalize `README.md`**

Cover, in order: what this is (MoneyPurse web dashboard), prerequisites (`ledger-service` running with Postgres, seeded per Task 5), exact run commands for both services with their ports, `npm test` for this project, and one line noting which six features map to which widgets (mirroring the spec's table in §1).

- [ ] **Step 3: Run the full frontend test suite one more time**

Run: `npm run build:tests && node --test dist-tests` (or the equivalent npm script from Task 2)
Expected: PASS, every test from Tasks 2, 4, 7, 8, 9, 11, 12, 14, 15.

- [ ] **Step 4: Commit**

```bash
git add moneypurse-web/README.md
git commit -m "docs: finalize moneypurse-web README"
```
