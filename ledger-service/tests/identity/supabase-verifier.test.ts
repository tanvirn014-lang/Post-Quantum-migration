import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT, calculateJwkThumbprint, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { JoseSupabaseVerifier } from "../../src/adapters/supabase/verifier.js";
import { InvalidTokenError } from "../../src/identity/errors.js";

const ISSUER = "https://project.supabase.co/auth/v1";

/** Mints an ES256 token with its own ephemeral key and returns the token plus a local JWKS
 *  resolver, so the verifier can be exercised without any network call. */
async function signedToken(claims: Record<string, unknown>, opts: { alg?: string; expSeconds?: number; issuer?: string; aud?: string } = {}) {
  const alg = opts.alg ?? "ES256";
  const { privateKey, publicKey } = await generateKeyPair(alg);
  const jwk = (await exportJWK(publicKey)) as JWK;
  const kid = await calculateJwkThumbprint(jwk);
  const publicJwk: JWK = { ...jwk, kid, alg, use: "sig" };
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg, kid, typ: "JWT" })
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.aud ?? "authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSeconds ?? 3600))
    .sign(privateKey);
  return { token, keyResolver: createLocalJWKSet({ keys: [publicJwk] }) };
}

describe("JoseSupabaseVerifier", () => {
  it("returns the identity from a valid ES256 Supabase token", async () => {
    const { token, keyResolver } = await signedToken({
      sub: "11111111-1111-1111-1111-111111111111",
      email: "Alice@Example.com",
      user_metadata: { full_name: "Alice Example" },
    });
    const verifier = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "https://unused", keyResolver });

    const identity = await verifier.verify(token);

    assert.equal(identity.supabaseUserId, "11111111-1111-1111-1111-111111111111");
    assert.equal(identity.email, "alice@example.com"); // normalized to lower case
    assert.equal(identity.fullName, "Alice Example");
  });

  it("falls back to the `name` metadata field, then null, for the full name", async () => {
    const withName = await signedToken({ sub: "a", email: "a@b.co", user_metadata: { name: "Only Name" } });
    const vName = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver: withName.keyResolver });
    assert.equal((await vName.verify(withName.token)).fullName, "Only Name");

    const without = await signedToken({ sub: "a", email: "a@b.co" });
    const vNone = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver: without.keyResolver });
    assert.equal((await vNone.verify(without.token)).fullName, null);
  });

  it("rejects a token signed by a different key", async () => {
    const a = await signedToken({ sub: "a", email: "a@b.co" });
    const b = await signedToken({ sub: "a", email: "a@b.co" });
    // Verify a's token against b's JWKS (key mismatch).
    const verifier = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver: b.keyResolver });
    await assert.rejects(() => verifier.verify(a.token), InvalidTokenError);
  });

  it("rejects a wrong issuer", async () => {
    const { token, keyResolver } = await signedToken({ sub: "a", email: "a@b.co" }, { issuer: "https://evil.example/auth/v1" });
    const verifier = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver });
    await assert.rejects(() => verifier.verify(token), InvalidTokenError);
  });

  it("rejects an expired token", async () => {
    const { token, keyResolver } = await signedToken({ sub: "a", email: "a@b.co" }, { expSeconds: -10 });
    const verifier = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver });
    await assert.rejects(() => verifier.verify(token), InvalidTokenError);
  });

  it("rejects a non-ES256 algorithm", async () => {
    const { token, keyResolver } = await signedToken({ sub: "a", email: "a@b.co" }, { alg: "RS256" });
    const verifier = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver });
    await assert.rejects(() => verifier.verify(token), InvalidTokenError);
  });

  it("rejects a token with no email claim", async () => {
    const { token, keyResolver } = await signedToken({ sub: "a" });
    const verifier = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver });
    await assert.rejects(() => verifier.verify(token), InvalidTokenError);
  });

  it("rejects a token whose audience is not the configured one", async () => {
    const { token, keyResolver } = await signedToken({ sub: "a", email: "a@b.co" }, { aud: "some-other-app" });
    const verifier = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver, audience: "authenticated" });
    await assert.rejects(() => verifier.verify(token), InvalidTokenError);
  });

  it("accepts a token with the configured audience", async () => {
    const { token, keyResolver } = await signedToken({ sub: "a", email: "a@b.co" });
    const verifier = new JoseSupabaseVerifier({ issuer: ISSUER, jwksUrl: "x", keyResolver, audience: "authenticated" });
    assert.equal((await verifier.verify(token)).supabaseUserId, "a");
  });
});
