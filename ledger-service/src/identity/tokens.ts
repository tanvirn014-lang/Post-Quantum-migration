import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, createLocalJWKSet, importPKCS8, jwtVerify, calculateJwkThumbprint, type JWK } from "jose";
import { InvalidTokenError } from "./errors.js";
import { isRole, type Role } from "./roles.js";

export interface AccessTokenClaims {
  userId: string;
  role: Role;
  customerId: string | null;
  jti: string;
}

export interface TokenServiceOptions {
  /** PKCS#8 PEM of an Ed25519 private key. */
  privateKeyPem: string;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
}

/**
 * Issues and verifies short-lived EdDSA (Ed25519) access tokens and publishes the matching
 * public key as a JWKS so the other services can verify tokens without sharing a secret.
 * Note the signature scheme here is classical; the proposal scopes PQ signatures out.
 */
export class TokenService {
  private constructor(
    private readonly options: TokenServiceOptions,
    private readonly signingKey: Awaited<ReturnType<typeof importPKCS8>>,
    private readonly publicJwk: JWK,
    private readonly verifyKeys: ReturnType<typeof createLocalJWKSet>,
  ) {}

  static async create(options: TokenServiceOptions): Promise<TokenService> {
    const signingKey = await importPKCS8(options.privateKeyPem, "EdDSA");
    const publicKeyObject = createPublicKey(createPrivateKey(options.privateKeyPem));
    const jwk = publicKeyObject.export({ format: "jwk" }) as JWK;
    const kid = await calculateJwkThumbprint(jwk);
    const publicJwk: JWK = { ...jwk, kid, alg: "EdDSA", use: "sig" };
    return new TokenService(options, signingKey, publicJwk, createLocalJWKSet({ keys: [publicJwk] }));
  }

  async signAccessToken(user: { id: string; role: Role; customerId: string | null }): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({ role: user.role, cid: user.customerId })
      .setProtectedHeader({ alg: "EdDSA", kid: this.publicJwk.kid as string, typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${this.options.accessTtlSeconds}s`)
      .sign(this.signingKey);
    return { token, expiresIn: this.options.accessTtlSeconds };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.verifyKeys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ["EdDSA"],
      });
      const role = payload["role"];
      const cid = payload["cid"];
      if (typeof payload.sub !== "string" || !isRole(role) || typeof payload.jti !== "string") {
        throw new InvalidTokenError();
      }
      return { userId: payload.sub, role, customerId: typeof cid === "string" ? cid : null, jti: payload.jti };
    } catch {
      throw new InvalidTokenError();
    }
  }

  jwks(): { keys: JWK[] } {
    return { keys: [this.publicJwk] };
  }
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 256 bits from the CSPRNG, URL-safe. Only the SHA-256 hash is ever stored. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}
