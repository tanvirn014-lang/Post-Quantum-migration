import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { InvalidTokenError } from "../../identity/errors.js";
import type { SupabaseIdentity, SupabaseVerifier } from "../../ports/supabase-verifier.js";

export interface JoseSupabaseVerifierOptions {
  /** Expected `iss`, e.g. https://<ref>.supabase.co/auth/v1 */
  issuer: string;
  /** JWKS endpoint, e.g. https://<ref>.supabase.co/auth/v1/.well-known/jwks.json */
  jwksUrl: string;
  /** Key resolver override for tests (a local JWKS); defaults to a cached remote JWKS. */
  keyResolver?: JWTVerifyGetKey;
}

function readFullName(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null;
  const record = meta as Record<string, unknown>;
  if (typeof record["full_name"] === "string") return record["full_name"];
  if (typeof record["name"] === "string") return record["name"];
  return null;
}

/**
 * Verifies Supabase ES256 access tokens against the project's published JWKS. The project signs
 * user tokens with asymmetric ECC keys, so verification needs only the public keys - no shared
 * secret and no service-role key. The signature scheme is classical, like the core's own EdDSA
 * tokens; the proposal scopes PQ signatures out.
 */
export class JoseSupabaseVerifier implements SupabaseVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly options: JoseSupabaseVerifierOptions) {
    this.keys = options.keyResolver ?? createRemoteJWKSet(new URL(options.jwksUrl));
  }

  async verify(token: string): Promise<SupabaseIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.options.issuer,
        algorithms: ["ES256"],
      });
      const sub = payload.sub;
      const email = payload["email"];
      if (typeof sub !== "string" || typeof email !== "string") throw new InvalidTokenError();
      return { supabaseUserId: sub, email: email.toLowerCase(), fullName: readFullName(payload["user_metadata"]) };
    } catch (err) {
      if (err instanceof InvalidTokenError) throw err;
      throw new InvalidTokenError();
    }
  }
}
