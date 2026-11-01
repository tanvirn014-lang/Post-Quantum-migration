import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { session } from "../../../lib/api/clients.js";
import { SessionLifecycle } from "../../../app/providers.js";
import type { CustomerAuthGateway } from "../../../lib/auth/customer-auth.js";
import { installFetch, json, type InstalledFetch } from "../../helpers/fetch-mock.js";
import { signOut } from "../../helpers/session.js";

const USER = { id: "u1", email: "dana@example.com", role: "customer", customerId: "c1", mustChangePassword: false };

/** A fresh gateway object that already holds a persisted Supabase session, so startup adopts it.
 *  A new instance per call mirrors the production default (`getSupabaseGateway()` is evaluated on
 *  every render, yielding a new object each time). */
function gatewayWithToken(): CustomerAuthGateway {
  return {
    async signIn() {
      return { accessToken: "x", refreshToken: null };
    },
    async refreshToken() {
      return "refreshed";
    },
    async signOut() {},
    async getInitialToken() {
      return "supabase-access-token";
    },
  };
}

describe("SessionLifecycle startup restore", () => {
  let stub: InstalledFetch | undefined;
  const client = new QueryClient();
  afterEach(async () => {
    stub?.uninstall();
    cleanup();
    if (session.getState().status === "authenticated") await signOut();
  });

  it("adopts a persisted Supabase session exactly once, across re-renders with a fresh gateway each time", async () => {
    // Establishing the session re-renders this component, and in production the default gateway is a
    // new object every render, so the restore effect re-fires each time. Without a run-once guard it
    // would re-adopt the token on every pass — the production 429 storm and auto-sign-out.
    stub = installFetch({ "GET /auth/me": () => json({ user: USER, permissions: ["account:read:own"] }) });

    const { rerender } = render(<SessionLifecycle client={client} gateway={gatewayWithToken()} />);
    await waitFor(() => assert.strictEqual(session.getState().status, "authenticated"));

    // Simulate further renders, each handing a brand-new gateway object (changed effect dependency).
    for (let i = 0; i < 3; i++) {
      rerender(<SessionLifecycle client={client} gateway={gatewayWithToken()} />);
      await new Promise((r) => setTimeout(r, 10));
    }

    assert.strictEqual(stub.callsTo("GET", "/auth/me").length, 1);
  });
});
