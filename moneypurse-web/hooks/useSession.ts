import { useSyncExternalStore } from "react";
import { session } from "../lib/api/clients";
import { loginWithFallback, logoutEverywhere } from "../lib/auth/customer-auth";
import { hasSecurityPermission, type SecurityPermission } from "../lib/auth/security-permissions";
import type { SessionState } from "../lib/auth/session";
import { getSupabaseGateway } from "../lib/auth/supabase-gateway";

export type { Role, SessionState, SessionUser } from "../lib/auth/session";

/** Reactive view of the single browser session. The server snapshot is the initial "loading"
 *  state, so server and first client render always agree (no hydration mismatch). */
export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}

export function useAuthActions() {
  return {
    restore: () => session.restore(),
    // Local login first (staff/seeded accounts resolve here); customers who exist only in the
    // Supabase add-on layer are picked up by the fallback.
    login: (email: string, password: string) => loginWithFallback(session, getSupabaseGateway(), email, password),
    logout: () => logoutEverywhere(session, getSupabaseGateway()),
    changePassword: (current: string, next: string) => session.changePassword(current, next),
  };
}

/** Ledger-service permission check, from the permissions GET /auth/me returned. */
export function useCan(permission: string): boolean {
  return useSession().permissions.includes(permission);
}

/** Security-console capability hint for the signed-in role (the server still enforces). */
export function useCanSecurity(permission: SecurityPermission): boolean {
  return hasSecurityPermission(useSession().user?.role, permission);
}
