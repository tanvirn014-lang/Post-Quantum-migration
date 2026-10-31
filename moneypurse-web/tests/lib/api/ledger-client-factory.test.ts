import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../../../lib/api/api-client.js";
import { createLedgerClient } from "../../../lib/api/ledger-client.js";
import { installFetch } from "../../helpers/fetch-mock.js";

test("createLedgerClient lists accounts with a customer filter and omits undefined query values", async () => {
  const stub = installFetch({ "GET /accounts": () => [] });
  try {
    const client = createLedgerClient(new ApiClient({ baseUrl: "http://ledger.test", auth: null }));
    await client.listAccounts({ customerId: "c-1", limit: undefined });
    assert.strictEqual(stub.calls[0]?.url, "http://ledger.test/accounts?customerId=c-1");
  } finally {
    stub.uninstall();
  }
});

test("createLedgerClient sends the bearer token, the Idempotency-Key and a string amount on transfers", async () => {
  const stub = installFetch({ "POST /transfers": () => ({ id: "txn_1" }) });
  try {
    const auth = { getAccessToken: () => "tok", refreshAccessToken: async () => null };
    const client = createLedgerClient(new ApiClient({ baseUrl: "http://ledger.test", auth }));
    await client.postTransfer({ idempotencyKey: "key-7", fromAccountId: "acc_1", toAccountId: "acc_2", amountMinorUnits: "125000", currency: "BDT", description: "rent" });
    const [call] = stub.calls;
    assert.strictEqual(call?.headers["authorization"], "Bearer tok");
    assert.strictEqual(call?.headers["idempotency-key"], "key-7");
    assert.deepStrictEqual(call?.body, { fromAccountId: "acc_1", toAccountId: "acc_2", amountMinorUnits: "125000", currency: "BDT", description: "rent" });
  } finally {
    stub.uninstall();
  }
});

test("createLedgerClient encodes path segments so an id cannot escape its route", async () => {
  const stub = installFetch({});
  try {
    const client = createLedgerClient(new ApiClient({ baseUrl: "http://ledger.test", auth: null }));
    await client.getAccount("../audit/events").catch(() => undefined);
    assert.strictEqual(stub.calls[0]?.path, "/accounts/..%2Faudit%2Fevents");
  } finally {
    stub.uninstall();
  }
});
