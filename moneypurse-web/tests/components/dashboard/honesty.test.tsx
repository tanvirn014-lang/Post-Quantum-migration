import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, screen } from "@testing-library/react";
import { AlertBanner } from "../../../components/alerts/AlertBanner.js";
import { CardManagementWidget } from "../../../components/dashboard/CardManagementWidget.js";
import { SavingsPotsWidget } from "../../../components/dashboard/SavingsPotsWidget.js";
import { installFetch, type InstalledFetch } from "../../helpers/fetch-mock.js";
import { account, renderWithClient, widgetProps } from "../../helpers/render.js";
import { signInAs, signOut } from "../../helpers/session.js";

describe("simulated panels are labelled, real alerts are real", () => {
  let stub: InstalledFetch | undefined;

  before(() => signInAs("customer"));
  after(() => signOut());
  afterEach(() => {
    stub?.uninstall();
    cleanup();
  });

  it("marks savings pots as SIMULATED with an explanation of why", () => {
    renderWithClient(<SavingsPotsWidget {...widgetProps} />);
    const badge = screen.getByText("SIMULATED");
    assert.match(badge.parentElement?.getAttribute("title") ?? "", /no backend exists/i);
  });

  it("marks card controls as SIMULATED", () => {
    renderWithClient(<CardManagementWidget {...widgetProps} />);
    assert.ok(screen.getByText("SIMULATED"));
  });

  it("shows the low-balance banner only from a live balance below the threshold", async () => {
    stub = installFetch({ "GET /accounts": () => [account({ kind: "current", balanceMinorUnits: "99999" })] });
    renderWithClient(<AlertBanner />);
    assert.ok(await screen.findByText(/balance is below/i));
  });

  it("shows no banner for a healthy balance - there are no fixture alerts behind it", async () => {
    stub = installFetch({ "GET /accounts": () => [account({ kind: "current", balanceMinorUnits: "5000000" })] });
    const view = renderWithClient(<AlertBanner />);
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(view.container.textContent, "");
    assert.ok(stub.callsTo("GET", "/accounts").length >= 1);
  });
});
