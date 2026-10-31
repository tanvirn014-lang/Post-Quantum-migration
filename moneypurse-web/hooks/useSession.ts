import { useSyncExternalStore } from "react";
import { session } from "../lib/api/clients";
import { hasSecurityPermission, type SecurityPermission } from "../lib/auth/security-permissions";
import type { SessionState } from "../lib/auth/session";

export type { Role, SessionState, SessionUser } from "../lib/auth/session";

/** Reactive view of the single browser session. The server snapshot is the initial "loading"
 *  state, so server and first client render always agree (no hydration mismatch). */
export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}

export function useAuthActions() {
  return {
    restore: () => session.restore(),
    login: (email: string, password: string) => session.login(email, password),
    logout: () => session.logout(),
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
