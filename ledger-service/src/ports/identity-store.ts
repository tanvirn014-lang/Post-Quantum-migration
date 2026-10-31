import type { Customer, NewCustomer, NewUser, RefreshTokenRecord, User } from "../identity/types.js";

export type UserPatch = Partial<
  Pick<User, "passwordHash" | "status" | "mustChangePassword" | "failedLoginCount" | "lockedUntil" | "lastLoginAt">
>;

export interface IdentityStore {
  /** Atomically creates a customer record and the portal user bound to it. */
  createCustomerWithUser(customer: NewCustomer, user: Omit<NewUser, "customerId" | "role">): Promise<{ customer: Customer; user: User }>;
  /** A customer record with no portal user (e.g. the bank's own treasury customer). */
  createCustomer(customer: NewCustomer): Promise<Customer>;
  createStaffUser(user: NewUser): Promise<User>;
  getCustomer(id: string): Promise<Customer | null>;
  listCustomers(): Promise<Customer[]>;

  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateUser(id: string, patch: UserPatch): Promise<User | null>;
  /** Atomically increments the failure counter; locks the account (and resets the counter)
   *  when it reaches maxAttempts. Returns the updated user. */
  registerLoginFailure(userId: string, now: Date, maxAttempts: number, lockMs: number): Promise<User | null>;

  createRefreshToken(record: RefreshTokenRecord): Promise<void>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Marks a token as used only if it is still unused and unrevoked; returns whether this
   *  call won. This is the race-free "consume once" primitive behind rotation. */
  consumeRefreshToken(id: string, now: Date): Promise<boolean>;
  revokeRefreshFamily(familyId: string, now: Date): Promise<void>;
  revokeAllRefreshTokensForUser(userId: string, now: Date): Promise<void>;
}
