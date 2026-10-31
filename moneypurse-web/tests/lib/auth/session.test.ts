import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError } from "../../../lib/api/api-client.js";
import { SessionManager, type SessionUser } from "../../../lib/auth/session.js";
import { apiError, installFetch, json, noContent, type InstalledFetch } from "../../helpers/fetch-mock.js";

const USER: SessionUser = { id: "u1", email: "ayesha@bank.test", role: "customer", customerId: "c1", mustChangePassword: false };
const PERMISSIONS = ["account:read:own", "transfer:create:own"];

const sessionBody = (token: string, user: SessionUser = USER) => ({ accessToken: token, tokenType: "Bearer", expiresIn: 600, user });

describe("SessionManager", () => {
  let stub: InstalledFetch | undefined;
  afterEach(() => stub?.uninstall());

  const manager = () => new SessionManager({ ledgerBaseUrl: "http://ledger.test" });

  it("starts in the loading state with no token", () => {
    const m = manager();
    assert.strictEqual(m.getState().status, "loading");
    assert.strictEqual(m.getAccessToken(), null);
  });

  it("logs in, loads the user and permissions from /auth/me, and keeps the token in memory only", async () => {
    stub = installFetch({
      "POST /auth/login": () => json(sessionBody("tok-1")),
      "GET /auth/me": () => json({ user: USER, permissions: PERMISSIONS }),
    });
    const m = manager();
    await m.login("ayesha@bank.test", "pw");
    assert.strictEqual(m.getState().status, "authenticated");
    assert.deepStrictEqual(m.getState().user, USER);
    assert.deepStrictEqual(m.getState().permissions, PERMISSIONS);
    assert.strictEqual(m.getAccessToken(), "tok-1");
    assert.strictEqual(stub.callsTo("GET", "/auth/me")[0]?.headers["authorization"], "Bearer tok-1");

    // The bearer credential must never touch web storage (XSS-readable).
    assert.strictEqual(globalThis.localStorage.length, 0);
    assert.ok(!JSON.stringify({ ...globalThis.localStorage }).includes("tok-1"));
  });

  it("sends cookies (credentials: include) to every /auth endpoint", async () => {
    stub = installFetch({
      "POST /auth/login": () => json(sessionBody("tok-1")),
      "GET /auth/me": () => json({ user: USER, permissions: PERMISSIONS }),
      "POST /auth/refresh": () => json(sessionBody("tok-2")),
      "POST /auth/logout": () => noContent(),
    });
    const m = manager();
    await m.login("a@b.test", "pw");
    await m.refreshAccessToken();
    await m.logout();
    for (const call of stub.calls) assert.strictEqual(call.credentials, "include", `${call.method} ${call.path}`);
  });

  it("surfaces the server's generic login failure and stays signed out", async () => {
    stub = installFetch({ "POST /auth/login": () => apiError(401, "INVALID_CREDENTIALS", "Invalid credentials") });
    const m = manager();
    await assert.rejects(() => m.login("nobody@bank.test", "pw"), (err: unknown) => err instanceof ApiRequestError && err.code === "INVALID_CREDENTIALS");
    assert.notStrictEqual(m.getState().status, "authenticated");
    assert.strictEqual(m.getAccessToken(), null);
  });

  it("notifies subscribers on every state change and stops after unsubscribe", async () => {
    stub = installFetch({
      "POST /auth/login": () => json(sessionBody("tok-1")),
      "GET /auth/me": () => json({ user: USER, permissions: PERMISSIONS }),
      "POST /auth/logout": () => noContent(),
    });
    const m = manager();
    let notified = 0;
    const unsubscribe = m.subscribe(() => notified++);
    await m.login("a@b.test", "pw");
    assert.ok(notified >= 1);
    await m.logout();
    const afterLogout = notified;
    unsubscribe();
    await m.login("a@b.test", "pw");
    assert.strictEqual(notified, afterLogout);
  });

  describe("restore (silent sign-in from the refresh cookie)", () => {
    it("becomes authenticated when the refresh cookie is still valid", async () => {
      stub = installFetch({
        "POST /auth/refresh": () => json(sessionBody("tok-9")),
        "GET /auth/me": () => json({ user: USER, permissions: PERMISSIONS }),
      });
      const m = manager();
      await m.restore();
      assert.strictEqual(m.getState().status, "authenticated");
      assert.strictEqual(m.getAccessToken(), "tok-9");
    });

    it("becomes anonymous when there is no valid refresh cookie", async () => {
      stub = installFetch({ "POST /auth/refresh": () => apiError(401, "INVALID_REFRESH_TOKEN", "invalid") });
      const m = manager();
      await m.restore();
      assert.strictEqual(m.getState().status, "anonymous");
      assert.strictEqual(m.getState().user, null);
    });

    it("runs once even if called repeatedly (React strict mode double effects)", async () => {
      stub = installFetch({ "POST /auth/refresh": () => apiError(401, "INVALID_REFRESH_TOKEN", "invalid") });
      const m = manager();
      await Promise.all([m.restore(), m.restore(), m.restore()]);
      assert.strictEqual(stub.callsTo("POST", "/auth/refresh").length, 1);
    });

    it("drops to anonymous if the refreshed session cannot load /auth/me", async () => {
      stub = installFetch({
        "POST /auth/refresh": () => json(sessionBody("tok-9")),
        "GET /auth/me": () => apiError(500, "INTERNAL_ERROR", "boom"),
      });
      const m = manager();
      await m.restore();
      assert.strictEqual(m.getState().status, "anonymous");
      assert.strictEqual(m.getAccessToken(), null);
    });
  });

  describe("refreshAccessToken", () => {
    it("is single-flight: concurrent callers share one refresh (refresh tokens rotate, a second use would revoke the session)", async () => {
      let n = 0;
      stub = installFetch({
        "POST /auth/refresh": async () => {
          n++;
          await new Promise((r) => setTimeout(r, 10));
          return json(sessionBody(`tok-${n}`));
        },
      });
      const m = manager();
      const tokens = await Promise.all([m.refreshAccessToken(), m.refreshAccessToken(), m.refreshAccessToken()]);
      assert.strictEqual(stub.callsTo("POST", "/auth/refresh").length, 1);
      assert.deepStrictEqual(tokens, ["tok-1", "tok-1", "tok-1"]);
      // A later, separate expiry triggers a fresh refresh.
      assert.strictEqual(await m.refreshAccessToken(), "tok-2");
    });

    it("ends the session when the server rejects the refresh token", async () => {
      stub = installFetch({
        "POST /auth/login": () => json(sessionBody("tok-1")),
        "GET /auth/me": () => json({ user: USER, permissions: PERMISSIONS }),
        "POST /auth/refresh": () => apiError(401, "INVALID_REFRESH_TOKEN", "revoked"),
      });
      const m = manager();
      await m.login("a@b.test", "pw");
      assert.strictEqual(await m.refreshAccessToken(), null);
      assert.strictEqual(m.getState().status, "anonymous");
      assert.strictEqual(m.getAccessToken(), null);
    });

    it("keeps the session on a transient network failure so the user can retry", async () => {
      stub = installFetch({
        "POST /auth/login": () => json(sessionBody("tok-1")),
        "GET /auth/me": () => json({ user: USER, permissions: PERMISSIONS }),
      });
      const m = manager();
      await m.login("a@b.test", "pw");
      stub.uninstall();
      const original = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new TypeError("offline");
      }) as typeof fetch;
      try {
        assert.strictEqual(await m.refreshAccessToken(), null);
        assert.strictEqual(m.getState().status, "authenticated");
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  describe("forced password change", () => {
    it("exposes the mustChangePassword flag, then clears it from the fresh session after a change", async () => {
      const pending = { ...USER, mustChangePassword: true };
      stub = installFetch({
        "POST /auth/login": () => json(sessionBody("tok-1", pending)),
        "GET /auth/me": (call) =>
          json({ user: call.headers["authorization"] === "Bearer tok-2" ? USER : pending, permissions: PERMISSIONS }),
        "POST /auth/change-password": () => json(sessionBody("tok-2")),
      });
      const m = manager();
      await m.login("a@b.test", "initial-pw");
      assert.strictEqual(m.getState().user?.mustChangePassword, true);

      await m.changePassword("initial-pw", "a-much-better-passphrase");
      assert.strictEqual(m.getState().user?.mustChangePassword, false);
      assert.strictEqual(m.getAccessToken(), "tok-2");
      const change = stub.callsTo("POST", "/auth/change-password")[0];
      assert.deepStrictEqual(change?.body, { currentPassword: "initial-pw", newPassword: "a-much-better-passphrase" });
      assert.strictEqual(change?.headers["authorization"], "Bearer tok-1");
    });

    it("keeps the pending state and exposes the policy problems when the new password is rejected", async () => {
      const pending = { ...USER, mustChangePassword: true };
      stub = installFetch({
        "POST /auth/login": () => json(sessionBody("tok-1", pending)),
        "GET /auth/me": () => json({ user: pending, permissions: PERMISSIONS }),
        "POST /auth/change-password": () =>
          apiError(400, "WEAK_PASSWORD", "Password does not meet the policy", { details: { problems: ["must be at least 12 characters"] } }),
      });
      const m = manager();
      await m.login("a@b.test", "initial-pw");
      await assert.rejects(
        () => m.changePassword("initial-pw", "short"),
        (err: unknown) => err instanceof ApiRequestError && (err.details as { problems: string[] }).problems.length === 1,
      );
      assert.strictEqual(m.getState().user?.mustChangePassword, true);
    });
  });

  describe("logout", () => {
    it("clears the session", async () => {
      stub = installFetch({
        "POST /auth/login": () => json(sessionBody("tok-1")),
        "GET /auth/me": () => json({ user: USER, permissions: PERMISSIONS }),
        "POST /auth/logout": () => noContent(),
      });
      const m = manager();
      await m.login("a@b.test", "pw");
      await m.logout();
      assert.strictEqual(m.getState().status, "anonymous");
      assert.strictEqual(m.getAccessToken(), null);
      assert.strictEqual(stub.callsTo("POST", "/auth/logout").length, 1);
    });

    it("still signs out locally when the server cannot be reached", async () => {
      stub = installFetch({
        "POST /auth/login": () => json(sessionBody("tok-1")),
        "GET /auth/me": () => json({ user: USER, permissions: PERMISSIONS }),
      });
      const m = manager();
      await m.login("a@b.test", "pw");
      stub.uninstall();
      const original = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new TypeError("offline");
      }) as typeof fetch;
      try {
        await assert.rejects(() => m.logout());
        assert.strictEqual(m.getState().status, "anonymous");
        assert.strictEqual(m.getAccessToken(), null);
      } finally {
        globalThis.fetch = original;
      }
    });
  });
});
