import type { Role, SessionState } from "./session";

export type Area = "public" | "account" | "customer" | "operator" | "security";

export const LOGIN_PATH = "/login";
export const SIGNUP_PATH = "/signup";
export const CHANGE_PASSWORD_PATH = "/change-password";

/** Which part of the app a path belongs to. Unknown paths default to the authenticated "account" area. */
export function areaOf(pathname: string): Area {
  if (pathname === LOGIN_PATH || pathname === SIGNUP_PATH) return "public";
  if (pathname === CHANGE_PASSWORD_PATH) return "account";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return "customer";
  if (pathname === "/operations" || pathname.startsWith("/operations/")) return "operator";
  if (pathname === "/security" || pathname.startsWith("/security/")) return "security";
  return "account";
}

export function landingPathFor(role: Role): string {
  switch (role) {
    case "customer":
      return "/dashboard";
    case "operator":
      return "/operations";
    case "security_admin":
    case "auditor":
      return "/security";
  }
}

/** Ledger-service permission that opens each area. Server-side checks remain authoritative. */
const AREA_PERMISSION: Record<Exclude<Area, "public" | "account">, string> = {
  customer: "account:read:own",
  operator: "customer:create",
  security: "audit:read",
};

/**
 * The single routing rule for the whole app. Returns the path the user must be sent to, or
 * null when they may stay where they are (or when the session is still resolving).
 */
export function redirectFor(pathname: string, session: SessionState): string | null {
  if (session.status === "loading") return null;

  if (session.status === "anonymous") return pathname === LOGIN_PATH || pathname === SIGNUP_PATH ? null : LOGIN_PATH;

  const user = session.user!;
  // A pending password change blocks everything else - it is the only thing the user may do.
  if (user.mustChangePassword) return pathname === CHANGE_PASSWORD_PATH ? null : CHANGE_PASSWORD_PATH;

  const landing = landingPathFor(user.role);
  const area = areaOf(pathname);
  // Signed-in users have no reason to see /login or the root; /change-password is only for the
  // forced change handled above (a voluntary change is not offered yet).
  if (pathname === "/" || pathname === LOGIN_PATH || pathname === SIGNUP_PATH || pathname === CHANGE_PASSWORD_PATH) return landing;
  if (area !== "public" && area !== "account" && !session.permissions.includes(AREA_PERMISSION[area])) return landing;
  return null;
}
