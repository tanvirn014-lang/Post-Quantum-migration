import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { AccountSummaryCards } from "../../../components/dashboard/AccountSummaryCards.js";
import { apiError, installFetch, type InstalledFetch } from "../../helpers/fetch-mock.js";
import { account, renderWithClient, widgetProps } from "../../helpers/render.js";
import { signInAs, signOut } from "../../helpers/session.js";

describe("AccountSummaryCards", () => {
  let stub: InstalledFetch | undefined;

  before(() => signInAs("customer"));
  after(() => signOut());
  afterEach(() => {
    stub?.uninstall();
    cleanup();
  });

  it("shows one labelled card per live account and a total, never a hard-coded id", async () => {
    stub = installFetch({
      "GET /accounts": () => [
        account({ id: "acc_cur", kind: "current", balanceMinorUnits: "10000" }),
        account({ id: "acc_sav", kind: "savings", balanceMinorUnits: "25000" }),
        account({ id: "acc_settle", kind: "settlement", balanceMinorUnits: "999999999" }),
      ],
    });
    renderWithClient(<AccountSummaryCards {...widgetProps} />);

    await screen.findByText("Current");
    assert.ok(screen.getByText("Savings"));
    assert.ok(screen.getByText("৳100.00"));
    assert.ok(screen.getByText("৳250.00"));
    assert.ok(screen.getByText("৳350.00"), "total of the two customer accounts");
    assert.strictEqual(screen.queryByText(/settlement/i), null, "bank-internal accounts are never shown to customers");
    assert.strictEqual(stub.calls.filter((c) => c.path.startsWith("/accounts/")).length, 0, "uses the list endpoint, not fixed ids");
    assert.strictEqual(stub.calls[0]?.headers["authorization"], "Bearer token-1");
  });

  it("handles a customer with a single account (no total) and with no accounts at all", async () => {
    stub = installFetch({ "GET /accounts": () => [account({ kind: "current", balanceMinorUnits: "500" })] });
    const view = renderWithClient(<AccountSummaryCards {...widgetProps} />);
    await screen.findByText("৳5.00");
    assert.strictEqual(screen.queryByText("Total"), null);
    view.unmount();
    stub.uninstall();

    stub = installFetch({ "GET /accounts": () => [] });
    renderWithClient(<AccountSummaryCards {...widgetProps} />);
    assert.ok(await screen.findByText("No accounts yet"));
  });

  it("numbers repeated kinds and omits the total when currencies differ", async () => {
    stub = installFetch({
      "GET /accounts": () => [
        account({ id: "a", kind: "savings", currency: "BDT" }),
        account({ id: "b", kind: "savings", currency: "USD" }),
      ],
    });
    renderWithClient(<AccountSummaryCards {...widgetProps} />);
    await screen.findByText("Savings 1");
    assert.ok(screen.getByText("Savings 2"));
    assert.strictEqual(screen.queryByText("Total"), null);
  });

  it("shows the shared retry state when the account list fails to load", async () => {
    stub = installFetch({ "GET /accounts": () => apiError(500, "INTERNAL_ERROR", "Something went wrong") });
    renderWithClient(<AccountSummaryCards {...widgetProps} />);
    await waitFor(() => assert.ok(screen.getByText(/retry/i)));
  });
});
