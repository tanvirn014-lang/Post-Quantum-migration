import { randomUUID } from "node:crypto";
import { EmailAlreadyRegisteredError } from "../../identity/errors.js";
import type { Customer, NewCustomer, NewUser, RefreshTokenRecord, User } from "../../identity/types.js";
import type { IdentityStore, UserPatch } from "../../ports/identity-store.js";

/** In-process IdentityStore for tests and database-free local runs. Not for production. */
export class MemoryIdentityStore implements IdentityStore {
  private customers = new Map<string, Customer>();
  private users = new Map<string, User>();
  private refreshTokens = new Map<string, RefreshTokenRecord>();

  private assertUserEmailFree(email: string): void {
    for (const u of this.users.values()) if (u.email === email) throw new EmailAlreadyRegisteredError();
  }

  private assertCustomerEmailFree(email: string): void {
    for (const c of this.customers.values()) if (c.email === email) throw new EmailAlreadyRegisteredError();
  }

  private insertUser(input: NewUser): User {
    const user: User = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      customerId: input.customerId,
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
      mustChangePassword: input.mustChangePassword,
      createdAt: new Date(),
      lastLoginAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async createCustomerWithUser(
    customerInput: NewCustomer,
    userInput: Omit<NewUser, "customerId" | "role">,
  ): Promise<{ customer: Customer; user: User }> {
    this.assertCustomerEmailFree(customerInput.email);
    this.assertUserEmailFree(userInput.email);
    const customer: Customer = { id: randomUUID(), fullName: customerInput.fullName, email: customerInput.email, createdAt: new Date() };
    this.customers.set(customer.id, customer);
    const user = this.insertUser({ ...userInput, role: "customer", customerId: customer.id });
    return { customer: { ...customer }, user: { ...user } };
  }

  async createCustomer(input: NewCustomer): Promise<Customer> {
    this.assertCustomerEmailFree(input.email);
    const customer: Customer = { id: randomUUID(), fullName: input.fullName, email: input.email, createdAt: new Date() };
    this.customers.set(customer.id, customer);
    return { ...customer };
  }

  async createStaffUser(input: NewUser): Promise<User> {
    this.assertUserEmailFree(input.email);
    return { ...this.insertUser(input) };
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const c = this.customers.get(id);
    return c ? { ...c } : null;
  }

  async listCustomers(): Promise<Customer[]> {
    return [...this.customers.values()].map((c) => ({ ...c }));
  }

  async findUserByEmail(email: string): Promise<User | null> {
    for (const u of this.users.values()) if (u.email === email) return { ...u };
    return null;
  }

  async findUserById(id: string): Promise<User | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()].map((u) => ({ ...u }));
  }

  async updateUser(id: string, patch: UserPatch): Promise<User | null> {
    const existing = this.users.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.users.set(id, updated);
    return { ...updated };
  }

  async registerLoginFailure(userId: string, now: Date, maxAttempts: number, lockMs: number): Promise<User | null> {
    const existing = this.users.get(userId);
    if (!existing) return null;
    const count = existing.failedLoginCount + 1;
    const updated: User =
      count >= maxAttempts
        ? { ...existing, failedLoginCount: 0, lockedUntil: new Date(now.getTime() + lockMs) }
        : { ...existing, failedLoginCount: count };
    this.users.set(userId, updated);
    return { ...updated };
  }

  async createRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.refreshTokens.set(record.id, { ...record });
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const r of this.refreshTokens.values()) if (r.tokenHash === tokenHash) return { ...r };
    return null;
  }

  async consumeRefreshToken(id: string, now: Date): Promise<boolean> {
    const r = this.refreshTokens.get(id);
    if (!r || r.usedAt || r.revokedAt) return false;
    this.refreshTokens.set(id, { ...r, usedAt: now });
    return true;
  }

  async revokeRefreshFamily(familyId: string, now: Date): Promise<void> {
    for (const [id, r] of this.refreshTokens) {
      if (r.familyId === familyId && !r.revokedAt) this.refreshTokens.set(id, { ...r, revokedAt: now });
    }
  }

  async revokeAllRefreshTokensForUser(userId: string, now: Date): Promise<void> {
    for (const [id, r] of this.refreshTokens) {
      if (r.userId === userId && !r.revokedAt) this.refreshTokens.set(id, { ...r, revokedAt: now });
    }
  }
}
