import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from "jose";
import { InvalidTokenError } from "../errors.js";
import { isRole, type Role } from "./permissions.js";

export interface Principal {
  userId: string;
  role: Role;
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

/**
 * Verifies ledger-service access tokens against its published public key (JWKS). No secret is
 * shared. Limitation: this service does not look the user up, so a token stays valid until it
 * expires (default 10 minutes) even if the account is disabled meanwhile.
 */
export class JwksTokenVerifier implements TokenVerifier {
  private constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  static remote(jwksUrl: string, issuer: string, audience: string): JwksTokenVerifier {
    return new JwksTokenVerifier(createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 5_000, timeoutDuration: 3_000 }), issuer, audience);
  }

  static local(jwks: JSONWebKeySet, issuer: string, audience: string): JwksTokenVerifier {
    return new JwksTokenVerifier(createLocalJWKSet(jwks), issuer, audience);
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.keys, { issuer: this.issuer, audience: this.audience, algorithms: ["EdDSA"] });
      const role = payload["role"];
      if (typeof payload.sub !== "string" || !isRole(role)) throw new InvalidTokenError();
      return { userId: payload.sub, role };
    } catch {
      throw new InvalidTokenError();
    }
  }
}
