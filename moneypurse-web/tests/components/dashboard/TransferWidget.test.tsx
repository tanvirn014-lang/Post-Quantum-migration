import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { TransferWidget } from "../../../components/dashboard/TransferWidget.js";
import { apiError, installFetch, json, type InstalledFetch } from "../../helpers/fetch-mock.js";
import { account, renderWithClient, widgetProps } from "../../helpers/render.js";
import { signInAs, signOut } from "../../helpers/session.js";

const ACCOUNTS = [
  account({ id: "acc_cur", kind: "current", balanceMinorUnits: "500000" }),
  account({ id: "acc_sav", kind: "savings", balanceMinorUnits: "100000" }),
];

describe("TransferWidget", () => {
  let stub: InstalledFetch | undefined;

  before(() => signInAs("customer"));
  after(() => signOut());
  afterEach(() => {
    stub?.uninstall();
    cleanup();
  });

  const amountInput = () => screen.getByLabelText(/^Amount/);
  const sendButton = () => screen.getByRole("button", { name: /^(Send|Retry|Sending)/ });

  it("posts a transfer with a bearer token, an Idempotency-Key and the amount as minor-unit string", async () => {
    stub = installFetch({
      "GET /accounts": () => ACCOUNTS,
      "POST /transfers": () => json({ id: "txn_1", description: "Transfer" }, 201),
    });
    renderWithClient(<TransferWidget {...widgetProps} />);
    await screen.findByLabelText("From");

    fireEvent.change(amountInput(), { target: { value: "1,250.50" } });
    fireEvent.click(sendButton());

    await screen.findByText("Sent ৳1,250.50.");
    const [post] = stub.callsTo("POST", "/transfers");
    assert.deepStrictEqual(post?.body, {
      fromAccountId: "acc_cur",
      toAccountId: "acc_sav",
      amountMinorUnits: "125050",
      currency: "BDT",
      description: "Transfer",
    });
    assert.match(post?.headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
    assert.strictEqual(post?.headers["authorization"], "Bearer token-1");
    await waitFor(() => assert.ok(stub!.callsTo("GET", "/accounts").length >= 2), { timeout: 2000 });
  });

  it("will not submit zero, negative or malformed amounts", async () => {
    stub = installFetch({ "GET /accounts": () => ACCOUNTS });
    renderWithClient(<TransferWidget {...widgetProps} />);
    await screen.findByLabelText("From");

    for (const bad of ["", "0", "-5", "1.234", "abc"]) {
      fireEvent.change(amountInput(), { target: { value: bad } });
      assert.strictEqual((sendButton() as HTMLButtonElement).disabled, true, JSON.stringify(bad));
    }
    fireEvent.change(amountInput(), { target: { value: "1.234" } });
    assert.ok(screen.getByText(/at most two decimals/i));
    assert.strictEqual(stub.callsTo("POST", "/transfers").length, 0);
  });

  it("shows the server's reason, and retries with the SAME idempotency key so a retry can never double-post", async () => {
    let attempts = 0;
    stub = installFetch({
      "GET /accounts": () => ACCOUNTS,
      "POST /transfers": () => {
        attempts++;
        return attempts === 1 ? apiError(409, "INSUFFICIENT_FUNDS", "Account does not have sufficient funds for this transaction") : json({ id: "txn_2" }, 201);
      },
    });
    renderWithClient(<TransferWidget {...widgetProps} />);
    await screen.findByLabelText("From");

    fireEvent.change(amountInput(), { target: { value: "9999" } });
    fireEvent.click(sendButton());
    assert.ok(await screen.findByText(/sufficient funds/i));
    assert.strictEqual(sendButton().textContent, "Retry");

    fireEvent.click(sendButton());
    await screen.findByText(/^Sent /);
    const [first, second] = stub.callsTo("POST", "/transfers");
    assert.strictEqual(first?.headers["idempotency-key"], second?.headers["idempotency-key"]);
  });

  it("uses a new idempotency key once the user changes the transfer (same key + different payload would be rejected)", async () => {
    stub = installFetch({
      "GET /accounts": () => ACCOUNTS,
      "POST /transfers": () => apiError(409, "INSUFFICIENT_FUNDS", "Account does not have sufficient funds for this transaction"),
    });
    renderWithClient(<TransferWidget {...widgetProps} />);
    await screen.findByLabelText("From");

    fireEvent.change(amountInput(), { target: { value: "9999" } });
    fireEvent.click(sendButton());
    await screen.findByText(/sufficient funds/i);
    fireEvent.change(amountInput(), { target: { value: "10" } });
    fireEvent.click(sendButton());
    await waitFor(() => assert.strictEqual(stub!.callsTo("POST", "/transfers").length, 2));
    const [first, second] = stub.callsTo("POST", "/transfers");
    assert.notStrictEqual(first?.headers["idempotency-key"], second?.headers["idempotency-key"]);
  });

  it("explains itself when the customer has no accounts", async () => {
    stub = installFetch({ "GET /accounts": () => [] });
    renderWithClient(<TransferWidget {...widgetProps} />);
    assert.ok(await screen.findByText(/need an account/i));
  });
});
