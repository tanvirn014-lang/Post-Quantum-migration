import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSupabaseGateway, type SupabaseAuthApi } from "../../../lib/auth/supabase-gateway";

function ok(session: { access_token: string; refresh_token: string | null } | null) {
  return { data: { session }, error: null };
}
function fail(message: string) {
  return { data: { session: null }, error: { message } };
}

function fakeAuth(overrides: Partial<SupabaseAuthApi> = {}): { auth: SupabaseAuthApi; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, value: unknown) => (calls[name] = [...(calls[name] ?? []), value]);
  const auth: SupabaseAuthApi = {
    async signUp(c) {
      record("signUp", c);
      return ok(null);
    },
    async verifyOtp(p) {
      record("verifyOtp", p);
      return ok({ access_token: "verified-access", refresh_token: "verified-refresh" });
    },
    async resend(p) {
      record("resend", p);
      return { data: {}, error: null };
    },
    async signInWithPassword(c) {
      record("signInWithPassword", c);
      return ok({ access_token: "signin-access", refresh_token: "signin-refresh" });
    },
    async refreshSession() {
      record("refreshSession", {});
      return ok({ access_token: "refreshed-access", refresh_token: "r" });
    },
    async signOut() {
      record("signOut", {});
      return { error: null };
    },
    async getSession() {
      record("getSession", {});
      return { data: { session: null } };
    },
    ...overrides,
  };
  return { auth, calls };
}

describe("createSupabaseGateway", () => {
  it("requestSignup sends email, password and full name, and triggers the signup OTP", async () => {
    const { auth, calls } = fakeAuth();
    await createSupabaseGateway(auth).requestSignup({ email: "dana@example.com", password: "pw12345678", fullName: "Dana Doe" });
    const c = calls.signUp![0] as { email: string; password: string; options?: { data?: { full_name?: string } } };
    assert.equal(c.email, "dana@example.com");
    assert.equal(c.password, "pw12345678");
    assert.equal(c.options?.data?.full_name, "Dana Doe");
  });

  it("requestSignup throws the Supabase error message", async () => {
    const { auth } = fakeAuth({ async signUp() { return fail("Email rate limit exceeded"); } });
    await assert.rejects(() => createSupabaseGateway(auth).requestSignup({ email: "a@b.co", password: "pw12345678", fullName: "A" }), /rate limit/i);
  });

  it("verifyCode verifies a signup OTP and returns the session tokens", async () => {
    const { auth, calls } = fakeAuth();
    const session = await createSupabaseGateway(auth).verifyCode({ email: "dana@example.com", code: "123456" });
    assert.deepEqual(session, { accessToken: "verified-access", refreshToken: "verified-refresh" });
    assert.deepEqual(calls.verifyOtp![0], { email: "dana@example.com", token: "123456", type: "signup" });
  });

  it("verifyCode throws when no session comes back", async () => {
    const { auth } = fakeAuth({ async verifyOtp() { return ok(null); } });
    await assert.rejects(() => createSupabaseGateway(auth).verifyCode({ email: "a@b.co", code: "123456" }));
  });

  it("resendCode re-sends the signup code", async () => {
    const { auth, calls } = fakeAuth();
    await createSupabaseGateway(auth).resendCode("dana@example.com");
    assert.deepEqual(calls.resend![0], { type: "signup", email: "dana@example.com" });
  });

  it("signIn returns the session tokens for a password login", async () => {
    const { auth } = fakeAuth();
    assert.deepEqual(await createSupabaseGateway(auth).signIn("dana@example.com", "pw"), {
      accessToken: "signin-access",
      refreshToken: "signin-refresh",
    });
  });

  it("signIn throws the Supabase error message", async () => {
    const { auth } = fakeAuth({ async signInWithPassword() { return fail("Invalid login credentials"); } });
    await assert.rejects(() => createSupabaseGateway(auth).signIn("a@b.co", "pw"), /invalid login/i);
  });

  it("refreshToken returns the new access token, or null on failure", async () => {
    assert.equal(await createSupabaseGateway(fakeAuth().auth).refreshToken(), "refreshed-access");
    const failing = fakeAuth({ async refreshSession() { return fail("expired"); } });
    assert.equal(await createSupabaseGateway(failing.auth).refreshToken(), null);
  });

  it("getInitialToken returns the persisted access token, or null", async () => {
    assert.equal(await createSupabaseGateway(fakeAuth().auth).getInitialToken(), null);
    const withSession = fakeAuth({ async getSession() { return { data: { session: { access_token: "persisted", refresh_token: "r" } } }; } });
    assert.equal(await createSupabaseGateway(withSession.auth).getInitialToken(), "persisted");
  });

  it("signOut calls Supabase sign out", async () => {
    const { auth, calls } = fakeAuth();
    await createSupabaseGateway(auth).signOut();
    assert.equal(calls.signOut!.length, 1);
  });
});
