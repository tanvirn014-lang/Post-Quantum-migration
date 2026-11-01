import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidTokenError } from "../../src/identity/errors.js";
import type { SupabaseIdentity, SupabaseVerifier } from "../../src/ports/supabase-verifier.js";
import { createTestApp } from "../helpers/test-app.js";

class FakeSupabaseVerifier implements SupabaseVerifier {
  constructor(private readonly byToken: Map<string, SupabaseIdentity>) {}
  async verify(token: string): Promise<SupabaseIdentity> {
    const id = this.byToken.get(token);
    if (!id) throw new InvalidTokenError();
    return id;
  }
}

const BOB: SupabaseIdentity = {
  supabaseUserId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  email: "bob@example.com",
  fullName: "Bob Example",
};

describe("HTTP: Supabase bearer tokens", () => {
  it("authenticates GET /auth/me with a Supabase token and provisions a customer", async () => {
    const app = await createTestApp({ supabaseAutoProvision: true }, { supabase: new FakeSupabaseVerifier(new Map([["supa-bob", BOB]])) });

    const res = await app.app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer supa-bob" } });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.user.email, "bob@example.com");
    assert.equal(body.user.role, "customer");
    assert.ok(body.user.customerId);
    assert.equal(body.user.mustChangePassword, false);
    assert.ok(Array.isArray(body.permissions) && body.permissions.includes("account:read:own"));
    await app.app.close();
  });

  it("does not auto-provision an unseen Supabase identity when provisioning is disabled (the default)", async () => {
    const app = await createTestApp({}, { supabase: new FakeSupabaseVerifier(new Map([["supa-bob", BOB]])) });
    const res = await app.app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer supa-bob" } });
    assert.equal(res.statusCode, 401);
    await app.app.close();
  });

  it("rejects an unknown Supabase token with 401", async () => {
    const app = await createTestApp({}, { supabase: new FakeSupabaseVerifier(new Map()) });
    const res = await app.app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer nope" } });
    assert.equal(res.statusCode, 401);
    await app.app.close();
  });

  it("without a verifier configured, a non-local token is still rejected", async () => {
    const app = await createTestApp();
    const res = await app.app.inject({ method: "GET", url: "/auth/me", headers: { authorization: "Bearer supa-bob" } });
    assert.equal(res.statusCode, 401);
    await app.app.close();
  });
});
