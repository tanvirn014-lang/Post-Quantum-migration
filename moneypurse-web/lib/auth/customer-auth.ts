import { ApiRequestError } from "../api/api-client";
import type { SignupSession } from "./signup-flow";
import type { SessionUser } from "./session";

/**
 * Glue between the browser session and the Supabase add-on identity layer. The session stays
 * Supabase-agnostic; these functions decide when to use Supabase and wire its token refresh into
 * the session. Pure orchestration over injected collaborators, so it is tested without the SDK.
 */

/** The slice of SessionManager this orchestration uses. */
export interface SessionLike {
  login(email: string, password: string): Promise<SessionUser>;
  adoptExternalSession(accessToken: string, refreshStrategy: () => Promise<string | null>): Promise<SessionUser>;
  logout(): Promise<void>;
}

/** The Supabase operations the orchestration needs (the full gateway also implements SignupGateway). */
export interface CustomerAuthGateway {
  signIn(email: string, password: string): Promise<SignupSession>;
  refreshToken(): Promise<string | null>;
  signOut(): Promise<void>;
  /** The access token of an already-persisted Supabase session, if any (for silent restore). */
  getInitialToken(): Promise<string | null>;
}

function isInvalidCredentials(err: unknown): boolean {
  return err instanceof ApiRequestError && (err.code === "INVALID_CREDENTIALS" || err.status === 401);
}

/**
 * Local login first (staff, seeded and existing accounts resolve here, and their passwords never
 * leave our backend); only an invalid-credentials result falls back to Supabase, for customers who
 * exist only there.
 */
export async function loginWithFallback(
  session: SessionLike,
  gateway: CustomerAuthGateway | null,
  email: string,
  password: string,
): Promise<SessionUser> {
  try {
    return await session.login(email, password);
  } catch (err) {
    if (gateway && isInvalidCredentials(err)) {
      const supaSession = await gateway.signIn(email, password);
      return session.adoptExternalSession(supaSession.accessToken, () => gateway.refreshToken());
    }
    throw err;
  }
}

/** Adopts the session returned by a completed OTP sign-up. */
export async function completeSignup(
  session: SessionLike,
  gateway: CustomerAuthGateway | null,
  signupSession: SignupSession,
): Promise<SessionUser> {
  const refresh = gateway ? () => gateway.refreshToken() : async () => null;
  return session.adoptExternalSession(signupSession.accessToken, refresh);
}

/** Signs out of Supabase (best effort) and then the local session. */
export async function logoutEverywhere(session: SessionLike, gateway: CustomerAuthGateway | null): Promise<void> {
  if (gateway) await gateway.signOut().catch(() => {});
  await session.logout();
}

/** On start, adopt an already-persisted Supabase session if one exists. Returns whether it did. */
export async function restoreExternalSession(session: SessionLike, gateway: CustomerAuthGateway | null): Promise<boolean> {
  if (!gateway) return false;
  const token = await gateway.getInitialToken();
  if (!token) return false;
  try {
    await session.adoptExternalSession(token, () => gateway.refreshToken());
    return true;
  } catch {
    return false;
  }
}
