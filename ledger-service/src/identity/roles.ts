export const ROLES = ["customer", "operator", "security_admin", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Every capability the API distinguishes. The matrix below is the single source of truth for
 * role-based access; routes name the permission they need and never test roles directly.
 */
export const PERMISSIONS = [
  "account:read:own",
  "account:read:any",
  "account:create",
  "transfer:create:own",
  "transaction:post:journal",
  "customer:create",
  "user:read",
  "user:create:staff",
  "user:disable",
  "audit:read",
  "audit:verify",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  customer: ["account:read:own", "transfer:create:own"],
  // Segregation of duties: operators onboard customers and post journal entries but do not
  // originate customer transfers, and cannot read the audit log or manage staff.
  operator: ["account:read:any", "account:create", "transaction:post:journal", "customer:create", "user:read"],
  security_admin: ["user:read", "user:create:staff", "user:disable", "audit:read", "audit:verify"],
  // Auditors are strictly read-only.
  auditor: ["account:read:any", "user:read", "audit:read", "audit:verify"],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
