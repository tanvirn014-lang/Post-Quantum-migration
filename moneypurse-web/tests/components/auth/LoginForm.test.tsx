import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { session } from "../../../lib/api/clients.js";
import { LoginForm } from "../../../components/auth/LoginForm.js";
import { apiError, installFetch, json, type InstalledFetch } from "../../helpers/fetch-mock.js";
import { signOut } from "../../helpers/session.js";

describe("LoginForm", () => {
  let stub: InstalledFetch | undefined;
  afterEach(async () => {
    stub?.uninstall();
    cleanup();
    if (session.getState().status === "authenticated") await signOut();
  });

  const fill = (email: string, password: string) => {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  };

  it("keeps the submit button disabled until both fields are filled", () => {
    render(<LoginForm />);
    const button = screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement;
    assert.strictEqual(button.disabled, true);
    fill("a@bank.test", "");
    assert.strictEqual(button.disabled, true);
    fill("a@bank.test", "x");
    assert.strictEqual(button.disabled, false);
  });

  it("shows only the server's generic message on failure, and clears the password field", async () => {
    stub = installFetch({ "POST /auth/login": () => apiError(401, "INVALID_CREDENTIALS", "Invalid credentials") });
    render(<LoginForm />);
    fill("nobody@bank.test", "wrong-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    assert.strictEqual(alert.textContent, "Invalid credentials");
    assert.strictEqual((screen.getByLabelText("Password") as HTMLInputElement).value, "");
    assert.deepStrictEqual(stub.callsTo("POST", "/auth/login")[0]?.body, { email: "nobody@bank.test", password: "wrong-password" });
  });

  it("signs in through the session: credentials posted, identity and permissions loaded", async () => {
    const user = { id: "u1", email: "ayesha@bank.test", role: "customer", customerId: "c1", mustChangePassword: false };
    stub = installFetch({
      "POST /auth/login": () => json({ accessToken: "tok", tokenType: "Bearer", expiresIn: 600, user }),
      "GET /auth/me": () => json({ user, permissions: ["account:read:own"] }),
    });
    render(<LoginForm />);
    fill("ayesha@bank.test", "correct-password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => assert.strictEqual(session.getState().status, "authenticated"));
    assert.strictEqual(session.getState().user?.email, "ayesha@bank.test");
    assert.deepStrictEqual(session.getState().permissions, ["account:read:own"]);
  });
});
