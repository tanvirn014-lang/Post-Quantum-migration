import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { TokenService } from "../../src/identity/tokens.js";
import { InvalidTokenError } from "../../src/identity/errors.js";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

const OPTS = { issuer: "iss", audience: "aud", accessTtlSeconds: 600 };
const user = { id: "u1", role: "customer" as const, customerId: "c1" };

describe("JWT signing-key rotation", () => {
  it("publishes the active key plus every retained verification key in the JWKS", async () => {
    const k1 = keypair();
    const k2 = keypair();
    const svc = await TokenService.create({ ...OPTS, privateKeyPem: k2.privatePem, additionalPublicKeyPems: [k1.publicPem] });
    assert.equal(svc.jwks().keys.length, 2);
    // Distinct kids, so verification can select the right key per token.
    const kids = new Set(svc.jwks().keys.map((k) => k.kid));
    assert.equal(kids.size, 2);
  });

  it("still verifies a token signed just before rotation while the old key is retained", async () => {
    const k1 = keypair();
    const k2 = keypair();
    const before = await TokenService.create({ ...OPTS, privateKeyPem: k1.privatePem });
    const { token } = await before.signAccessToken(user);

    // Rotate: k2 is now the active signing key; k1's public key is kept for the TTL window.
    const after = await TokenService.create({ ...OPTS, privateKeyPem: k2.privatePem, additionalPublicKeyPems: [k1.publicPem] });
    assert.equal((await after.verifyAccessToken(token)).userId, "u1", "pre-rotation token still verifies");

    const fresh = await after.signAccessToken(user);
    assert.equal((await after.verifyAccessToken(fresh.token)).userId, "u1", "new active key verifies too");
  });

  it("rejects a token once its signing key is retired from the JWKS", async () => {
    const k1 = keypair();
    const k2 = keypair();
    const before = await TokenService.create({ ...OPTS, privateKeyPem: k1.privatePem });
    const { token } = await before.signAccessToken(user);

    // The rotation window has closed: only k2 is published.
    const afterWindow = await TokenService.create({ ...OPTS, privateKeyPem: k2.privatePem });
    await assert.rejects(() => afterWindow.verifyAccessToken(token), InvalidTokenError);
  });
});
