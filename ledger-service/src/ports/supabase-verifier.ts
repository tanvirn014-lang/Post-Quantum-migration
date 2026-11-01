/** The identity a verified Supabase access token carries into the banking core. */
export interface SupabaseIdentity {
  /** The Supabase user id (the token's `sub`); the stable link to a local user. */
  supabaseUserId: string;
  /** Normalized (lower-cased) email from the token. */
  email: string;
  /** Display name from the token's user metadata, if any. */
  fullName: string | null;
}

/**
 * Verifies a Supabase-issued access token and extracts its identity. Implementations verify the
 * signature against the project's published keys; they never trust unverified token contents.
 */
export interface SupabaseVerifier {
  verify(token: string): Promise<SupabaseIdentity>;
}
