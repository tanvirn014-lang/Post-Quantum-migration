export const ROLES = ["customer", "operator", "security_admin", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const PERMISSIONS = [
  "overview:read",
  "peers:read",
  "peers:manage",
  "config:read",
  "config:manage",
  "telemetry:read",
  "alerts:acknowledge",
  "audit:read",
  "audit:verify",
  "cbom:read",
  "cbom:generate",
  "hndl:run",
  "benchmarks:read",
  "experiments:run",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: readonly Permission[] = [
  "overview:read",
  "peers:read",
  "config:read",
  "telemetry:read",
  "audit:read",
  "audit:verify",
  "cbom:read",
  "hndl:run",
  "benchmarks:read",
];

/**
 * This service only serves staff. Customers and bank operators hold no security permissions at
 * all. Security administrators can change enforcement; auditors can see everything but change
 * nothing (the HNDL simulator is read-only educational computation, so auditors may run it).
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  customer: [],
  operator: [],
  security_admin: [...READ_ONLY, "peers:manage", "config:manage", "alerts:acknowledge", "cbom:generate", "experiments:run"],
  auditor: READ_ONLY,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
