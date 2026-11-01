import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ApiRequestError } from "../../../lib/api/api-client";
import {
  completeSignup,
  loginWithFallback,
  logoutEverywhere,
  restoreExternalSession,
  type CustomerAuthGateway,
  type SessionLike,
} from "../../../lib/auth/customer-auth";
import type { SessionUser } from "../../../lib/auth/session";

const USER: SessionUser = { id: "u1", email: "dana@example.com", role: "customer", customerId: "c1", mustChangePassword: false };

class FakeSession implements SessionLike {
  loginCalls: { email: string; password: string }[] = [];
  adopted: { token: string; refresh: () => Promise<string | null> }[] = [];
  logoutCalls = 0;
  loginError: unknown = null;
  async login(email: string, password: string): Promise<SessionUser> {
    this.loginCalls.push({ email, password });
    if (this.loginError) throw this.loginError;
    return USER;
  }
  async adoptExternalSession(token: string, refresh: () => Promise<string | null>): Promise<SessionUser> {
    this.adopted.push({ token, refresh });
    return USER;
  }
  async logout(): Promise<void> {
    this.logoutCalls++;
  }
}

class FakeGateway implements CustomerAuthGateway {
  signInResult = { accessToken: "supa-access", refreshToken: "supa-refresh" };
  signInCalls: { email: string; password: string }[] = [];
  signOutCalls = 0;
  initialToken: string | null = null;
  refreshValue: string | null = "refreshed";
  async signIn(email: string, password: string) {
    this.signInCalls.push({ email, password });
    return this.signInResult;
  }
  async refreshToken() {
    return this.refreshValue;
  }
  async signOut() {
    this.signOutCalls++;
  }
  async getInitialToken() {
    return this.initialToken;
  }
}

const invalidCreds = () => new ApiRequestError("Invalid credentials", "INVALID_CREDENTIALS", 401);

describe("customer auth orchestration", () => {
  let session: FakeSession;
  let gateway: FakeGateway;
  beforeEach(() => {
    session = new FakeSession();
    gateway = new FakeGateway();
  });

  describe("loginWithFallback", () => {
    it("uses local login when it succeeds and never touches Supabase", async () => {
      await loginWithFallback(session, gateway, "operator@bank.test", "pw");
      assert.equal(session.loginCalls.length, 1);
      assert.equal(gateway.signInCalls.length, 0);
      assert.equal(session.adopted.length, 0);
    });

    it("falls back to Supabase only when local login reports invalid credentials", async () => {
      session.loginError = invalidCreds();
      await loginWithFallback(session, gateway, "dana@example.com", "pw");
      assert.equal(gateway.signInCalls.length, 1);
      assert.equal(session.adopted[0]?.token, "supa-access");
    });

    it("adopts a session whose refresh strategy delegates to the gateway", async () => {
      session.loginError = invalidCreds();
      await loginWithFallback(session, gateway, "dana@example.com", "pw");
      const refresh = session.adopted[0]!.refresh;
      assert.equal(await refresh(), "refreshed");
    });

    it("does not fall back on a non-credential error (e.g. network)", async () => {
      session.loginError = new ApiRequestError("offline", "NETWORK_ERROR", 0);
      await assert.rejects(() => loginWithFallback(session, gateway, "dana@example.com", "pw"));
      assert.equal(gateway.signInCalls.length, 0);
    });

    it("rethrows the local error when Supabase is not configured", async () => {
      session.loginError = invalidCreds();
      await assert.rejects(() => loginWithFallback(session, null, "dana@example.com", "pw"), (e: unknown) => e instanceof ApiRequestError && e.code === "INVALID_CREDENTIALS");
    });
  });

  describe("completeSignup", () => {
    it("adopts the verified sign-up session", async () => {
      await completeSignup(session, gateway, { accessToken: "new-access", refreshToken: "r" });
      assert.equal(session.adopted[0]?.token, "new-access");
      assert.equal(await session.adopted[0]!.refresh(), "refreshed");
    });
  });

  describe("logoutEverywhere", () => {
    it("signs out of Supabase and then the local session", async () => {
      await logoutEverywhere(session, gateway);
      assert.equal(gateway.signOutCalls, 1);
      assert.equal(session.logoutCalls, 1);
    });

    it("still signs out locally when there is no gateway", async () => {
      await logoutEverywhere(session, null);
      assert.equal(session.logoutCalls, 1);
    });
  });

  describe("restoreExternalSession", () => {
    it("adopts an existing Supabase session on start", async () => {
      gateway.initialToken = "persisted-token";
      const restored = await restoreExternalSession(session, gateway);
      assert.equal(restored, true);
      assert.equal(session.adopted[0]?.token, "persisted-token");
    });

    it("returns false when there is no Supabase session or no gateway", async () => {
      assert.equal(await restoreExternalSession(session, gateway), false); // initialToken null
      assert.equal(await restoreExternalSession(session, null), false);
      assert.equal(session.adopted.length, 0);
    });
  });
});
