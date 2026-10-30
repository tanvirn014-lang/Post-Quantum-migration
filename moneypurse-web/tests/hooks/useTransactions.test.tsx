import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTransactionDescriptions } from "../../hooks/useTransactions.js";

type FetchArgs = [string, (RequestInit & { headers?: Record<string, string> }) | undefined];

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

test("useTransactionDescriptions exposes a refetch that re-fetches every underlying transaction query", async () => {
  const fetchMock = mock.fn(async (url: string, ..._rest: FetchArgs extends [string, infer R] ? [R] : never) =>
    new Response(
      JSON.stringify({ transaction: { id: url.split("/").pop(), description: "Groceries" }, postings: [] }),
      { status: 200 },
    ),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const client = new QueryClient();
  const { result } = renderHook(() => useTransactionDescriptions(["txn_1", "txn_2"]), {
    wrapper: wrapperFor(client),
  });

  await waitFor(() => assert.strictEqual(result.current.isLoading, false));
  assert.strictEqual(fetchMock.mock.callCount(), 2);

  await act(async () => {
    await result.current.refetch();
  });

  assert.strictEqual(fetchMock.mock.callCount(), 4);
});
