import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { getAccount, listPostings, postTransfer } from "../../../lib/api/ledger-client.js";

type FetchArgs = [string, (RequestInit & { headers?: Record<string, string> }) | undefined];

test("getAccount calls GET /accounts/:id and returns the parsed account", async () => {
  const fetchMock = mock.fn(async (..._args: FetchArgs) =>
    new Response(JSON.stringify({ id: "acc_1", balanceMinorUnits: "500" }), { status: 200 }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const account = await getAccount("acc_1");
  assert.strictEqual(fetchMock.mock.calls[0]!.arguments[0], "http://localhost:3000/accounts/acc_1");
  assert.strictEqual(account.balanceMinorUnits, "500");
});

test("listPostings includes the limit query param when provided", async () => {
  const fetchMock = mock.fn(async (..._args: FetchArgs) => new Response(JSON.stringify([]), { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await listPostings("acc_1", 10);
  assert.strictEqual(fetchMock.mock.calls[0]!.arguments[0], "http://localhost:3000/accounts/acc_1/postings?limit=10");
});

test("postTransfer sends the Idempotency-Key header and keeps amountMinorUnits as a string", async () => {
  const fetchMock = mock.fn(async (..._args: FetchArgs) => new Response(JSON.stringify({ id: "txn_1" }), { status: 201 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await postTransfer({
    idempotencyKey: "key-1",
    fromAccountId: "acc_1",
    toAccountId: "acc_2",
    amountMinorUnits: "1000",
    currency: "BDT",
    description: "test",
  });
  const [, init] = fetchMock.mock.calls[0]!.arguments;
  assert.strictEqual(init?.headers?.["Idempotency-Key"], "key-1");
  const body = JSON.parse(init?.body as string);
  assert.strictEqual(typeof body.amountMinorUnits, "string");
  assert.strictEqual(body.amountMinorUnits, "1000");
});

test("getAccount throws the backend's error message on a non-2xx response", async () => {
  const fetchMock = mock.fn(async (..._args: FetchArgs) =>
    new Response(JSON.stringify({ error: { code: "ACCOUNT_NOT_FOUND", message: "nope" } }), { status: 404 }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await assert.rejects(() => getAccount("missing"), /nope/);
});
