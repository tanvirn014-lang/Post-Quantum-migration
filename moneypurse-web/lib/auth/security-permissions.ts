import type { Role } from "./session";

/**
 * UI hints for what the signed-in role may do in the security console. security-service does
 * not (yet) publish its permission set the way ledger-service does at /auth/me, so this mirrors
 * security-service/src/auth/permissions.ts. It only decides which controls to show - the
 * server enforces every action and answers 403 regardless of what the UI offers.
 */
export type SecurityPermission = "peers:manage" | "config:manage" | "alerts:acknowledge" | "telemetry:read";

const SECURITY_PERMISSIONS: Record<Role, readonly SecurityPermission[]> = {
  customer: [],
  operator: [],
  security_admin: ["peers:manage", "config:manage", "alerts:acknowledge", "telemetry:read"],
  auditor: ["telemetry:read"],
};

export function hasSecurityPermission(role: Role | null | undefined, permission: SecurityPermission): boolean {
  return role ? SECURITY_PERMISSIONS[role].includes(permission) : false;
}

export function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes(permission);
}
