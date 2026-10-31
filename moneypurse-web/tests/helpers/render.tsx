import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Renders with a fresh QueryClient that never retries, so a failing request surfaces at once. */
export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

export const noop = () => {};
export const widgetProps = { editMode: false, hidden: false, onToggleHidden: noop };

export function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc_1",
    ownerCustomerId: "cust-1",
    currency: "BDT",
    kind: "current",
    status: "active",
    balanceMinorUnits: "10000",
    allowOverdraft: false,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}
