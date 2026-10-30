import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSummaryCards } from "../../../components/dashboard/AccountSummaryCards.js";
import { DEMO_CUSTOMER_ACCOUNTS } from "../../../lib/demo-accounts.js";

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccountSummaryCards editMode={false} hidden={false} onToggleHidden={() => {}} />
    </QueryClientProvider>,
  );
}

test("shows the widget's retry state when the savings account fails, instead of silently rendering only the primary card", async () => {
  globalThis.fetch = mock.fn(async (url: string) => {
    if (url.includes(DEMO_CUSTOMER_ACCOUNTS.savings)) {
      return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    }
    return new Response(JSON.stringify({ id: DEMO_CUSTOMER_ACCOUNTS.primary, balanceMinorUnits: "10000", currency: "BDT" }), {
      status: 200,
    });
  }) as unknown as typeof fetch;

  renderWithClient();

  await waitFor(() => assert.ok(screen.getByText(/retry/i)));
  cleanup();
});

test("shows a simple total of both accounts' balances once both load", async () => {
  globalThis.fetch = mock.fn(async (url: string) => {
    const balance = url.includes(DEMO_CUSTOMER_ACCOUNTS.savings) ? "25000" : "10000";
    return new Response(JSON.stringify({ id: "acc", balanceMinorUnits: balance, currency: "BDT" }), { status: 200 });
  }) as unknown as typeof fetch;

  renderWithClient();

  await waitFor(() => assert.ok(screen.getByText("৳350.00")));
  cleanup();
});
