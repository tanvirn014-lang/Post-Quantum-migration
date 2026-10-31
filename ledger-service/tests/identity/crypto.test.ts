import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PasswordHasher, checkPasswordPolicy } from "../../src/identity/password.js";
import { PERMISSIONS, ROLES, hasPermission, permissionsFor } from "../../src/identity/roles.js";
import { TokenService, generateRefreshToken, hashRefreshToken } from "../../src/identity/tokens.js";

const pem = () => generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const tokenOptions = { issuer: "iss", audience: "aud", accessTtlSeconds: 600 };

describe("PasswordHasher", () => {
  const hasher = new PasswordHasher({ logN: 10 });

  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hasher.hash("correct-horse-battery");
    assert.ok(stored.startsWith("scrypt$10$8$1$"));
    assert.strictEqual(await hasher.verify("correct-horse-battery", stored), true);
    assert.strictEqual(await hasher.verify("correct-horse-batterY", stored), false);
  });

  it("salts every hash", async () => {
    assert.notStrictEqual(await hasher.hash("same-password-123"), await hasher.hash("same-password-123"));
  });

  it("rejects malformed stored values instead of throwing", async () => {
    assert.strictEqual(await hasher.verify("x", "plaintext"), false);
    assert.strictEqual(await hasher.verify("x", "bcrypt$a$b$c$d$e"), false);
  });

  it("flags hashes made with a weaker cost for rehashing", async () => {
    const weak = await new PasswordHasher({ logN: 9 }).hash("some-long-password");
    assert.strictEqual(hasher.needsRehash(weak), true);
    assert.strictEqual(hasher.needsRehash(await hasher.hash("some-long-password")), false);
  });
});

describe("password policy", () => {
  it("accepts a long passphrase", () => {
    assert.deepStrictEqual(checkPasswordPolicy("correct-horse-battery-staple", { email: "ana@bank.test" }), []);
  });

  it("rejects short, repetitive, common and email-derived passwords", () => {
    assert.ok(checkPasswordPolicy("short").some((p) => /at least 12/.test(p)));
    assert.ok(checkPasswordPolicy("aaaaaaaaaaaaaaaa").some((p) => /distinct/.test(p)));
    assert.ok(checkPasswordPolicy("changeme1234").some((p) => /common/.test(p)));
    assert.ok(checkPasswordPolicy("my-ananya-password-1", { email: "ananya@bank.test" }).some((p) => /email/.test(p)));
  });

  it("caps the length so hashing cannot be used for denial of service", () => {
    assert.ok(checkPasswordPolicy("x".repeat(129) + "abcde").some((p) => /at most 128/.test(p)));
  });
});

describe("roles and permissions", () => {
  it("defines a non-empty permission set per role drawn from the known permissions", () => {
    for (const role of ROLES) {
      assert.ok(permissionsFor(role).length > 0);
      for (const p of permissionsFor(role)) assert.ok((PERMISSIONS as readonly string[]).includes(p));
    }
  });

  it("keeps segregation of duties: only customers move their own money; only security admins manage staff", () => {
    assert.strictEqual(hasPermission("customer", "transfer:create:own"), true);
    for (const role of ["operator", "security_admin", "auditor"] as const) {
      assert.strictEqual(hasPermission(role, "transfer:create:own"), false, role);
    }
    assert.strictEqual(hasPermission("security_admin", "user:create:staff"), true);
    for (const role of ["customer", "operator", "auditor"] as const) {
      assert.strictEqual(hasPermission(role, "user:create:staff"), false, role);
    }
  });

  it("makes auditors strictly read-only", () => {
    const writes = ["account:create", "transfer:create:own", "transaction:post:journal", "customer:create", "user:create:staff", "user:disable"] as const;
    for (const p of writes) assert.strictEqual(hasPermission("auditor", p), false, p);
  });
});

describe("TokenService", () => {
  it("round-trips claims and publishes a matching EdDSA JWKS", async () => {
    const tokens = await TokenService.create({ privateKeyPem: pem(), ...tokenOptions });
    const { token, expiresIn } = await tokens.signAccessToken({ id: "u1", role: "auditor", customerId: null });
    assert.strictEqual(expiresIn, 600);
    const claims = await tokens.verifyAccessToken(token);
    assert.strictEqual(claims.userId, "u1");
    assert.strictEqual(claims.role, "auditor");
    assert.strictEqual(claims.customerId, null);

    const [jwk] = tokens.jwks().keys;
    assert.strictEqual(jwk?.kty, "OKP");
    assert.strictEqual(jwk?.crv, "Ed25519");
    assert.strictEqual(jwk?.alg, "EdDSA");
    assert.ok(!("d" in (jwk ?? {})), "the JWKS must never contain private key material");
  });

  it("rejects a token signed by a different key", async () => {
    const a = await TokenService.create({ privateKeyPem: pem(), ...tokenOptions });
    const b = await TokenService.create({ privateKeyPem: pem(), ...tokenOptions });
    const { token } = await b.signAccessToken({ id: "u1", role: "customer", customerId: "c1" });
    await assert.rejects(a.verifyAccessToken(token), { code: "INVALID_TOKEN" });
  });

  it("rejects wrong issuer, wrong audience, expired and garbage tokens", async () => {
    const key = pem();
    const tokens = await TokenService.create({ privateKeyPem: key, ...tokenOptions });
    const other = await TokenService.create({ privateKeyPem: key, ...tokenOptions, issuer: "someone-else" });
    const otherAud = await TokenService.create({ privateKeyPem: key, ...tokenOptions, audience: "other-aud" });
    const expired = await TokenService.create({ privateKeyPem: key, ...tokenOptions, accessTtlSeconds: -10 });

    await assert.rejects(tokens.verifyAccessToken((await other.signAccessToken({ id: "u", role: "customer", customerId: "c" })).token), { code: "INVALID_TOKEN" });
    await assert.rejects(tokens.verifyAccessToken((await otherAud.signAccessToken({ id: "u", role: "customer", customerId: "c" })).token), { code: "INVALID_TOKEN" });
    await assert.rejects(tokens.verifyAccessToken((await expired.signAccessToken({ id: "u", role: "customer", customerId: "c" })).token), { code: "INVALID_TOKEN" });
    await assert.rejects(tokens.verifyAccessToken("not.a.jwt"), { code: "INVALID_TOKEN" });
  });

  it("rejects an unsigned (alg=none) token", async () => {
    const tokens = await TokenService.create({ privateKeyPem: pem(), ...tokenOptions });
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "u1", role: "operator", iss: "iss", aud: "aud", jti: "j", exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
    await assert.rejects(tokens.verifyAccessToken(`${header}.${payload}.`), { code: "INVALID_TOKEN" });
  });

  it("rejects a token carrying an unknown role", async () => {
    const key = pem();
    const tokens = await TokenService.create({ privateKeyPem: key, ...tokenOptions });
    const { token } = await tokens.signAccessToken({ id: "u1", role: "customer", customerId: "c1" });
    const [h, , s] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "u1", role: "root", iss: "iss", aud: "aud", jti: "j", exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
    await assert.rejects(tokens.verifyAccessToken(`${h}.${forgedPayload}.${s}`), { code: "INVALID_TOKEN" });
  });
});

describe("refresh tokens", () => {
  it("generates unguessable URL-safe tokens and stores only their hash", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    assert.notStrictEqual(a.token, b.token);
    assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
    assert.strictEqual(a.hash, hashRefreshToken(a.token));
    assert.notStrictEqual(a.hash, a.token);
  });
});
