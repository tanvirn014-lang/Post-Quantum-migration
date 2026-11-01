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
  /** PKCS#8 PEM of the ACTIVE Ed25519 signing key (new tokens are signed with this). */
  privateKeyPem: string;
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
  /** SPKI PEMs of PREVIOUS public keys, kept in the JWKS for verification only so tokens signed
   *  just before a key rotation still verify until they expire. Drop a key here once no unexpired
   *  token could have been signed with it (i.e. after accessTtlSeconds). */
  additionalPublicKeyPems?: string[];
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
    private readonly allPublicJwks: JWK[],
  ) {}

  private static async toPublicJwk(publicKeyPemOrObject: ReturnType<typeof createPublicKey>): Promise<JWK> {
    const jwk = publicKeyPemOrObject.export({ format: "jwk" }) as JWK;
    const kid = await calculateJwkThumbprint(jwk);
    return { ...jwk, kid, alg: "EdDSA", use: "sig" };
  }

  static async create(options: TokenServiceOptions): Promise<TokenService> {
    const signingKey = await importPKCS8(options.privateKeyPem, "EdDSA");
    const publicJwk = await TokenService.toPublicJwk(createPublicKey(createPrivateKey(options.privateKeyPem)));
    // Previous public keys are kept for verification during a rotation window (sign with the active
    // key only). jose selects the matching key by the token's `kid`.
    const additional = await Promise.all((options.additionalPublicKeyPems ?? []).map((pem) => TokenService.toPublicJwk(createPublicKey(pem))));
    const allPublicJwks = [publicJwk, ...additional];
    return new TokenService(options, signingKey, publicJwk, createLocalJWKSet({ keys: allPublicJwks }), allPublicJwks);
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
    return { keys: this.allPublicJwks };
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
