import type { Role } from "./roles.js";

export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  customerId: string | null;
  status: UserStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
  mustChangePassword: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface Customer {
  id: string;
  fullName: string;
  email: string;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  role: Role;
  customerId: string | null;
  mustChangePassword: boolean;
}

export interface NewCustomer {
  fullName: string;
  email: string;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** The user as exposed over the API - never includes the password hash or lockout state. */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  customerId: string | null;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    customerId: user.customerId,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
