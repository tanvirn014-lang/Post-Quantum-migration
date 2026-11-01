import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { session } from "../../../lib/api/clients.js";
import { SignupForm } from "../../../components/auth/SignupForm.js";
import type { SupabaseGateway } from "../../../lib/auth/supabase-gateway.js";
import { installFetch, json, type InstalledFetch } from "../../helpers/fetch-mock.js";
import { signOut } from "../../helpers/session.js";

const USER = { id: "u1", email: "dana@example.com", role: "customer", customerId: "c1", mustChangePassword: false };

function fakeGateway(overrides: Partial<SupabaseGateway> = {}): SupabaseGateway & { requested: unknown[]; verified: unknown[] } {
  const requested: unknown[] = [];
  const verified: unknown[] = [];
  return {
    requested,
    verified,
    async requestSignup(input) {
      requested.push(input);
    },
    async verifyCode(input) {
      verified.push(input);
      return { accessToken: "verified-access", refreshToken: "r" };
    },
    async resendCode() {},
    async signIn() {
      return { accessToken: "x", refreshToken: null };
    },
    async refreshToken() {
      return "refreshed";
    },
    async signOut() {},
    async getInitialToken() {
      return null;
    },
    ...overrides,
  };
}

describe("SignupForm", () => {
  let stub: InstalledFetch | undefined;
  afterEach(async () => {
    stub?.uninstall();
    cleanup();
    if (session.getState().status === "authenticated") await signOut();
  });

  const fillDetails = (name: string, email: string, password: string) => {
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  };

  it("tells the user when sign-up is not configured and shows no form", () => {
    render(<SignupForm gateway={null} />);
    assert.ok(screen.getByText(/not configured|unavailable/i));
    assert.strictEqual(screen.queryByLabelText("Email"), null);
  });

  it("step 1: validates the email locally without calling the gateway", async () => {
    const gateway = fakeGateway();
    render(<SignupForm gateway={gateway} />);
    fillDetails("Dana Doe", "not-an-email", "s3cret-passphrase");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    const alert = await screen.findByRole("alert");
    assert.match(alert.textContent ?? "", /email/i);
    assert.strictEqual(gateway.requested.length, 0);
  });

  it("step 1 → 2: requests the code, then shows the code entry", async () => {
    const gateway = fakeGateway();
    render(<SignupForm gateway={gateway} />);
    fillDetails("Dana Doe", "dana@example.com", "s3cret-passphrase");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByLabelText(/code/i);
    assert.equal(gateway.requested.length, 1);
    assert.deepEqual(gateway.requested[0], { email: "dana@example.com", password: "s3cret-passphrase", fullName: "Dana Doe" });
  });

  it("step 2: verifies the code and signs the customer in", async () => {
    stub = installFetch({ "GET /auth/me": () => json({ user: USER, permissions: ["account:read:own"] }) });
    const gateway = fakeGateway();
    render(<SignupForm gateway={gateway} />);
    fillDetails("Dana Doe", "dana@example.com", "s3cret-passphrase");
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    const codeInput = await screen.findByLabelText(/code/i);
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() => assert.strictEqual(session.getState().status, "authenticated"));
    assert.deepEqual(gateway.verified[0], { email: "dana@example.com", code: "123456" });
    assert.strictEqual(session.getAccessToken(), "verified-access");
  });
});
