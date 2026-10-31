import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, createTestApp, type TestApp } from "../helpers/test-app.js";

describe("authentication flows", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });

  async function newCustomerUser() {
    const c = await t.customer();
    return c.user;
  }

  it("logs in, returns a bearer token and sets an HttpOnly, SameSite=Strict refresh cookie scoped to /auth", async () => {
    const user = await newCustomerUser();
    const res = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: user.email, password: TEST_PASSWORD } });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.tokenType, "Bearer");
    assert.strictEqual(body.user.email, user.email);
    assert.ok(!("passwordHash" in body.user), "never expose the password hash");
    assert.strictEqual(res.headers["cache-control"], "no-store");

    const cookie = res.cookies.find((c) => c.name === "pq_refresh");
    assert.ok(cookie);
    assert.strictEqual(cookie.httpOnly, true);
    assert.strictEqual(cookie.sameSite, "Strict");
    assert.strictEqual(cookie.path, "/auth");
    assert.ok(!res.body.includes(cookie.value), "the refresh token must not appear in the response body");
  });

  it("normalizes email case and whitespace at login", async () => {
    const user = await newCustomerUser();
    const res = await t.login(`  ${user.email.toUpperCase()} `);
    assert.strictEqual(res.statusCode, 200);
  });

  it("gives the identical response for an unknown user, a wrong password and a disabled account", async () => {
    const user = await newCustomerUser();
    const disabled = await t.customer();
    await t.stores.identity.updateUser(disabled.user.id, { status: "disabled" });

    const responses = await Promise.all([
      t.login("nobody@bank.test"),
      t.login(user.email, "wrong-password-123"),
      t.login(disabled.user.email),
    ]);
    for (const r of responses) {
      assert.strictEqual(r.statusCode, 401);
      assert.deepStrictEqual(Object.keys(r.body.error).sort(), ["code", "message", "requestId"]);
      assert.strictEqual(r.body.error.code, "INVALID_CREDENTIALS");
      assert.strictEqual(r.body.error.message, "Invalid credentials");
    }
  });

  it("validates the login body", async () => {
    const res = await t.app.inject({ method: "POST", url: "/auth/login", payload: { email: "nope", password: "" } });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.json().error.code, "VALIDATION_ERROR");
  });

  it("locks the account after repeated failures and keeps it locked even for the right password", async () => {
    const user = await newCustomerUser();
    for (let i = 0; i < 5; i++) assert.strictEqual((await t.login(user.email, "wrong-password-123")).statusCode, 401);
    assert.strictEqual((await t.login(user.email)).statusCode, 401, "locked: correct password must not work");

    t.clock.now = new Date(t.clock.now.getTime() + 16 * 60_000);
    assert.strictEqual((await t.login(user.email)).statusCode, 200, "lock expires after the configured window");
  });

  it("records failures, lockouts and successes in the audit log without logging secrets", async () => {
    const user = await newCustomerUser();
    for (let i = 0; i < 5; i++) await t.login(user.email, "wrong-password-123");
    const events = await t.stores.audit.listAscending(0, 100);
    const actions = events.map((e) => `${e.action}:${e.outcome}`);
    assert.ok(actions.includes("auth.login:failure"));
    assert.ok(actions.includes("auth.account_locked:success"));
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes("wrong-password-123"));
    assert.ok(!serialized.includes(TEST_PASSWORD));
  });

  it("rate-limits the login endpoint per client", async () => {
    const limited = await createTestApp({ loginRateLimitMax: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await limited.app.inject({ method: "POST", url: "/auth/login", payload: { email: "a@bank.test", password: "whatever-123" } })).statusCode);
    }
    assert.deepStrictEqual(statuses, [401, 401, 401, 429, 429]);
    const blocked = await limited.app.inject({ method: "POST", url: "/auth/login", payload: { email: "a@bank.test", password: "x" } });
    assert.strictEqual(blocked.json().error.code, "RATE_LIMITED");
  });

  describe("refresh token rotation", () => {
    async function loggedIn() {
      const user = await newCustomerUser();
      const login = await t.login(user.email);
      return { user, login, cookie: login.cookies.find((c) => c.name === "pq_refresh")!.value };
    }

    it("issues a new access token and rotates the refresh cookie", async () => {
      const { cookie } = await loggedIn();
      const res = await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie } });
      assert.strictEqual(res.statusCode, 200);
      const rotated = res.cookies.find((c) => c.name === "pq_refresh");
      assert.ok(rotated);
      assert.notStrictEqual(rotated.value, cookie);
      assert.ok(res.json().accessToken);
    });

    it("treats reuse of a rotated token as theft and revokes the whole family", async () => {
      const { cookie } = await loggedIn();
      const first = await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie } });
      const newCookie = first.cookies.find((c) => c.name === "pq_refresh")!.value;

      const replay = await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie } });
      assert.strictEqual(replay.statusCode, 401);
      assert.strictEqual(replay.json().error.code, "INVALID_REFRESH_TOKEN");

      const afterTheft = await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: newCookie } });
      assert.strictEqual(afterTheft.statusCode, 401, "the legitimate descendant token is revoked too");
      const actions = (await t.stores.audit.listAscending(0, 100)).map((e) => e.action);
      assert.ok(actions.includes("auth.refresh_reuse_detected"));
    });

    it("rejects a missing, unknown or expired refresh token", async () => {
      assert.strictEqual((await t.app.inject({ method: "POST", url: "/auth/refresh" })).statusCode, 401);
      assert.strictEqual((await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: "x".repeat(43) } })).statusCode, 401);
      const { cookie } = await loggedIn();
      t.clock.now = new Date(t.clock.now.getTime() + 8 * 86_400_000);
      assert.strictEqual((await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie } })).statusCode, 401);
    });

    it("refuses to refresh for a user disabled after login", async () => {
      const { user, cookie } = await loggedIn();
      await t.stores.identity.updateUser(user.id, { status: "disabled" });
      assert.strictEqual((await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie } })).statusCode, 401);
    });

    it("blocks cookie-authenticated requests from origins that are not allow-listed (CSRF)", async () => {
      const { cookie } = await loggedIn();
      const evil = await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie }, headers: { origin: "https://evil.example" } });
      assert.strictEqual(evil.statusCode, 403);
      assert.strictEqual(evil.json().error.code, "ORIGIN_NOT_ALLOWED");
      const ok = await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie }, headers: { origin: "http://localhost:3100" } });
      assert.strictEqual(ok.statusCode, 200);
    });

    it("logout revokes the refresh token and clears the cookie", async () => {
      const { cookie } = await loggedIn();
      const out = await t.app.inject({ method: "POST", url: "/auth/logout", cookies: { pq_refresh: cookie } });
      assert.strictEqual(out.statusCode, 204);
      assert.strictEqual((await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie } })).statusCode, 401);
    });
  });

  describe("access tokens", () => {
    it("rejects malformed, missing and non-bearer Authorization headers", async () => {
      for (const authorization of [undefined, "Bearer", "Basic abc", "Bearer a b", "bearer not.a.jwt"]) {
        const res = await t.app.inject({ method: "GET", url: "/auth/me", ...(authorization ? { headers: { authorization } } : {}) });
        assert.strictEqual(res.statusCode, 401, String(authorization));
      }
    });

    it("stops honouring a still-valid token as soon as the user is disabled", async () => {
      const c = await t.customer();
      assert.strictEqual((await t.app.inject({ method: "GET", url: "/auth/me", headers: t.bearer(c.token) })).statusCode, 200);
      await t.stores.identity.updateUser(c.user.id, { status: "disabled" });
      assert.strictEqual((await t.app.inject({ method: "GET", url: "/auth/me", headers: t.bearer(c.token) })).statusCode, 401);
    });

    it("reports the role's permissions at /auth/me", async () => {
      const op = await t.staff("operator");
      const me = (await t.app.inject({ method: "GET", url: "/auth/me", headers: t.bearer(op.token) })).json();
      assert.strictEqual(me.user.role, "operator");
      assert.ok(me.permissions.includes("account:create"));
      assert.ok(!me.permissions.includes("audit:read"));
    });

    it("publishes only public key material at the JWKS endpoint", async () => {
      const res = await t.app.inject({ method: "GET", url: "/.well-known/jwks.json" });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(!JSON.stringify(res.json()).includes('"d"'));
    });
  });

  describe("forced password change", () => {
    it("blocks everything except change-password, /auth/me and logout until the password is changed", async () => {
      const operator = await t.staff("operator");
      const created = await t.app.inject({
        method: "POST",
        url: "/customers",
        headers: t.bearer(operator.token),
        payload: { fullName: "New Customer", email: "new.customer@bank.test", password: "initial-pass-phrase-1" },
      });
      assert.strictEqual(created.statusCode, 201, created.body);

      const login = await t.login("new.customer@bank.test", "initial-pass-phrase-1");
      assert.strictEqual(login.statusCode, 200);
      assert.strictEqual(login.body.user.mustChangePassword, true);
      const token = login.body.accessToken as string;

      const blocked = await t.app.inject({ method: "GET", url: "/accounts", headers: t.bearer(token) });
      assert.strictEqual(blocked.statusCode, 403);
      assert.strictEqual(blocked.json().error.code, "PASSWORD_CHANGE_REQUIRED");
      assert.strictEqual((await t.app.inject({ method: "GET", url: "/auth/me", headers: t.bearer(token) })).statusCode, 200);

      const changed = await t.app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers: t.bearer(token),
        payload: { currentPassword: "initial-pass-phrase-1", newPassword: "a-much-better-passphrase-2" },
      });
      assert.strictEqual(changed.statusCode, 200, changed.body);
      assert.strictEqual(changed.json().user.mustChangePassword, false);
      const fresh = changed.json().accessToken as string;
      assert.strictEqual((await t.app.inject({ method: "GET", url: "/accounts", headers: t.bearer(fresh) })).statusCode, 200);
      assert.strictEqual((await t.login("new.customer@bank.test", "initial-pass-phrase-1")).statusCode, 401, "old password no longer works");
    });

    it("validates the new password and the current password on change", async () => {
      const c = await t.customer();
      const weak = await t.app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers: t.bearer(c.token),
        payload: { currentPassword: TEST_PASSWORD, newPassword: "short" },
      });
      assert.strictEqual(weak.statusCode, 400);
      assert.strictEqual(weak.json().error.code, "WEAK_PASSWORD");
      assert.ok(weak.json().error.details.problems.length > 0);

      const wrongCurrent = await t.app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers: t.bearer(c.token),
        payload: { currentPassword: "not-my-password-1", newPassword: "a-much-better-passphrase-2" },
      });
      assert.strictEqual(wrongCurrent.statusCode, 400);
      assert.strictEqual(wrongCurrent.json().error.code, "CURRENT_PASSWORD_INCORRECT");

      const same = await t.app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers: t.bearer(c.token),
        payload: { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
      });
      assert.strictEqual(same.statusCode, 400);
    });

    it("revokes all existing sessions when the password changes", async () => {
      const c = await t.customer();
      const cookie = (await t.login(c.user.email)).cookies.find((x) => x.name === "pq_refresh")!.value;
      await t.app.inject({
        method: "POST",
        url: "/auth/change-password",
        headers: t.bearer(c.token),
        payload: { currentPassword: TEST_PASSWORD, newPassword: "a-much-better-passphrase-2" },
      });
      assert.strictEqual((await t.app.inject({ method: "POST", url: "/auth/refresh", cookies: { pq_refresh: cookie } })).statusCode, 401);
    });
  });
});
