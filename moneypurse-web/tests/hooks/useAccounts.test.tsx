import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccount } from "../../hooks/useAccounts.js";

type FetchArgs = [string, (RequestInit & { headers?: Record<string, string> }) | undefined];

test("useAccount resolves with the account returned by the API", async () => {
  // Mock globalThis.fetch, not the ledger-client module's exports: real ES module
  // namespace objects are non-configurable, so mock.method() on an `import * as`
  // namespace does not reliably work (see Task 4's ledger-client.test.ts, which
  // establishes this same fetch-mocking pattern).
  globalThis.fetch = mock.fn(async (..._args: FetchArgs) =>
    new Response(JSON.stringify({ id: "acc_1", balanceMinorUnits: "500" }), { status: 200 }),
  ) as unknown as typeof fetch;

  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAccount("acc_1"), { wrapper });
  await waitFor(() => assert.strictEqual(result.current.isSuccess, true));
  assert.strictEqual(result.current.data?.balanceMinorUnits, "500");
});
