import { createHash, randomUUID } from "node:crypto";
import {
  CurrentPasswordIncorrectError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  InvalidTokenError,
  UserNotFoundError,
  WeakPasswordError,
} from "../identity/errors.js";
import { checkPasswordPolicy, type PasswordHasher } from "../identity/password.js";
import type { Role } from "../identity/roles.js";
import { generateRefreshToken, hashRefreshToken, type TokenService } from "../identity/tokens.js";
import { toPublicUser, type Customer, type PublicUser, type User } from "../identity/types.js";
import type { IdentityStore } from "../ports/identity-store.js";
import type { AuditService } from "./audit-service.js";

export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  correlationId?: string | undefined;
}

export interface Session {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface IdentityServiceDeps {
  store: IdentityStore;
  tokens: TokenService;
  hasher: PasswordHasher;
  audit: AuditService;
  limits: { maxFailedAttempts: number; lockMinutes: number; refreshTtlDays: number };
  clock?: () => Date;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const STAFF_ROLES: readonly Role[] = ["operator", "security_admin", "auditor"];

export class IdentityService {
  private readonly clock: () => Date;

  constructor(private readonly deps: IdentityServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  private auditCtx(ctx: RequestContext) {
    return { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null, correlationId: ctx.correlationId ?? null };
  }

  private async issueSession(user: User, familyId: string): Promise<Session> {
    const now = this.clock();
    const { token: accessToken, expiresIn } = await this.deps.tokens.signAccessToken(user);
    const refresh = generateRefreshToken();
    const refreshExpiresAt = new Date(now.getTime() + this.deps.limits.refreshTtlDays * 86_400_000);
    await this.deps.store.createRefreshToken({
      id: randomUUID(),
      userId: user.id,
      familyId,
      tokenHash: refresh.hash,
      expiresAt: refreshExpiresAt,
      usedAt: null,
      revokedAt: null,
      createdAt: now,
    });
    return { user: toPublicUser(user), accessToken, expiresIn, refreshToken: refresh.token, refreshExpiresAt };
  }

  async login(emailRaw: string, password: string, ctx: RequestContext): Promise<Session> {
    const email = normalizeEmail(emailRaw);
    const now = this.clock();
    const user = await this.deps.store.findUserByEmail(email);

    if (!user) {
      await this.deps.hasher.burn(password);
      await this.deps.audit.record({
        action: "auth.login",
        outcome: "failure",
        ...this.auditCtx(ctx),
        details: { reason: "unknown_user", emailSha256: createHash("sha256").update(email).digest("hex").slice(0, 16) },
      });
      throw new InvalidCredentialsError();
    }

    // Verify first, then look at status/lock: every failure path costs the same scrypt run.
    const passwordOk = await this.deps.hasher.verify(password, user.passwordHash);
    const locked = user.lockedUntil !== null && user.lockedUntil > now;
    if (user.status !== "active" || locked) {
      await this.deps.audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: "auth.login",
        outcome: "failure",
        ...this.auditCtx(ctx),
        details: { reason: user.status !== "active" ? "disabled" : "locked" },
      });
      throw new InvalidCredentialsError();
    }

    if (!passwordOk) {
      const updated = await this.deps.store.registerLoginFailure(
        user.id,
        now,
        this.deps.limits.maxFailedAttempts,
        this.deps.limits.lockMinutes * 60_000,
      );
      await this.deps.audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: "auth.login",
        outcome: "failure",
        ...this.auditCtx(ctx),
        details: { reason: "bad_password" },
      });
      if (updated?.lockedUntil && updated.lockedUntil > now) {
        await this.deps.audit.record({
          actorUserId: user.id,
          actorRole: user.role,
          action: "auth.account_locked",
          outcome: "success",
          ...this.auditCtx(ctx),
          details: { lockedUntil: updated.lockedUntil.toISOString() },
        });
      }
      throw new InvalidCredentialsError();
    }

    const upgradedHash = this.deps.hasher.needsRehash(user.passwordHash) ? await this.deps.hasher.hash(password) : undefined;
    const refreshed = await this.deps.store.updateUser(user.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
      ...(upgradedHash !== undefined ? { passwordHash: upgradedHash } : {}),
    });
    const session = await this.issueSession(refreshed ?? user, randomUUID());
    await this.deps.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: "auth.login",
      outcome: "success",
      ...this.auditCtx(ctx),
    });
    return session;
  }

  async refresh(rawToken: string, ctx: RequestContext): Promise<Session> {
    const now = this.clock();
    const record = await this.deps.store.findRefreshTokenByHash(hashRefreshToken(rawToken));
    if (!record) throw new InvalidRefreshTokenError();

    if (record.usedAt || record.revokedAt) {
      // A rotated token presented again means two parties hold it: assume theft, kill the family.
      await this.deps.store.revokeRefreshFamily(record.familyId, now);
      await this.deps.audit.record({
        actorUserId: record.userId,
        action: "auth.refresh_reuse_detected",
        outcome: "denied",
        ...this.auditCtx(ctx),
        details: { familyId: record.familyId },
      });
      throw new InvalidRefreshTokenError();
    }
    if (record.expiresAt <= now) throw new InvalidRefreshTokenError();

    const user = await this.deps.store.findUserById(record.userId);
    if (!user || user.status !== "active") {
      await this.deps.store.revokeRefreshFamily(record.familyId, now);
      throw new InvalidRefreshTokenError();
    }

    const won = await this.deps.store.consumeRefreshToken(record.id, now);
    if (!won) {
      await this.deps.store.revokeRefreshFamily(record.familyId, now);
      throw new InvalidRefreshTokenError();
    }

    const session = await this.issueSession(user, record.familyId);
    await this.deps.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: "auth.refresh",
      outcome: "success",
      ...this.auditCtx(ctx),
    });
    return session;
  }

  async logout(rawToken: string | undefined, ctx: RequestContext): Promise<void> {
    if (!rawToken) return;
    const record = await this.deps.store.findRefreshTokenByHash(hashRefreshToken(rawToken));
    if (!record) return;
    await this.deps.store.revokeRefreshFamily(record.familyId, this.clock());
    const user = await this.deps.store.findUserById(record.userId);
    await this.deps.audit.record({
      actorUserId: record.userId,
      actorRole: user?.role ?? null,
      action: "auth.logout",
      outcome: "success",
      ...this.auditCtx(ctx),
    });
  }

  /** Verifies the access token and loads the live user, so disabling an account or changing a
   *  role takes effect immediately rather than when the token expires. */
  async authenticate(accessToken: string): Promise<User> {
    const claims = await this.deps.tokens.verifyAccessToken(accessToken);
    const user = await this.deps.store.findUserById(claims.userId);
    if (!user || user.status !== "active") throw new InvalidTokenError();
    return user;
  }

  async changePassword(userId: string, current: string, next: string, ctx: RequestContext): Promise<Session> {
    const user = await this.deps.store.findUserById(userId);
    if (!user) throw new UserNotFoundError(userId);

    if (!(await this.deps.hasher.verify(current, user.passwordHash))) {
      await this.deps.audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: "auth.password_change",
        outcome: "failure",
        ...this.auditCtx(ctx),
        details: { reason: "current_password_incorrect" },
      });
      throw new CurrentPasswordIncorrectError();
    }
    const problems = checkPasswordPolicy(next, { email: user.email });
    if (next === current) problems.push("must differ from the current password");
    if (problems.length > 0) throw new WeakPasswordError(problems);

    const now = this.clock();
    const updated = await this.deps.store.updateUser(user.id, {
      passwordHash: await this.deps.hasher.hash(next),
      mustChangePassword: false,
    });
    await this.deps.store.revokeAllRefreshTokensForUser(user.id, now);
    const session = await this.issueSession(updated ?? user, randomUUID());
    await this.deps.audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: "auth.password_change",
      outcome: "success",
      ...this.auditCtx(ctx),
    });
    return session;
  }

  async createCustomerWithUser(
    actor: User,
    input: { fullName: string; email: string; password: string },
    ctx: RequestContext,
  ): Promise<{ customer: Customer; user: PublicUser }> {
    const email = normalizeEmail(input.email);
    const problems = checkPasswordPolicy(input.password, { email });
    if (problems.length > 0) throw new WeakPasswordError(problems);

    const { customer, user } = await this.deps.store.createCustomerWithUser(
      { fullName: input.fullName.trim(), email },
      { email, passwordHash: await this.deps.hasher.hash(input.password), mustChangePassword: true },
    );
    await this.deps.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "customer.create",
      resourceType: "customer",
      resourceId: customer.id,
      outcome: "success",
      ...this.auditCtx(ctx),
      details: { userId: user.id },
    });
    return { customer, user: toPublicUser(user) };
  }

  async createStaffUser(
    actor: User,
    input: { email: string; role: Role; password: string },
    ctx: RequestContext,
  ): Promise<PublicUser> {
    if (!STAFF_ROLES.includes(input.role)) throw new ForbiddenError("Staff users must have a staff role");
    const email = normalizeEmail(input.email);
    const problems = checkPasswordPolicy(input.password, { email });
    if (problems.length > 0) throw new WeakPasswordError(problems);

    const user = await this.deps.store.createStaffUser({
      email,
      passwordHash: await this.deps.hasher.hash(input.password),
      role: input.role,
      customerId: null,
      mustChangePassword: true,
    });
    await this.deps.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "user.create",
      resourceType: "user",
      resourceId: user.id,
      outcome: "success",
      ...this.auditCtx(ctx),
      details: { role: input.role },
    });
    return toPublicUser(user);
  }

  async listUsers(): Promise<PublicUser[]> {
    return (await this.deps.store.listUsers()).map(toPublicUser);
  }

  async listCustomers(): Promise<Customer[]> {
    return this.deps.store.listCustomers();
  }

  async getCustomer(id: string): Promise<Customer | null> {
    return this.deps.store.getCustomer(id);
  }

  async findCustomerByEmail(email: string): Promise<Customer | null> {
    return this.deps.store.findCustomerByEmail(normalizeEmail(email));
  }

  async setUserStatus(actor: User, targetId: string, status: "active" | "disabled", ctx: RequestContext): Promise<PublicUser> {
    if (actor.id === targetId) throw new ForbiddenError("You cannot change your own account status");
    const updated = await this.deps.store.updateUser(targetId, { status });
    if (!updated) throw new UserNotFoundError(targetId);
    if (status === "disabled") await this.deps.store.revokeAllRefreshTokensForUser(targetId, this.clock());
    await this.deps.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: status === "disabled" ? "user.disable" : "user.enable",
      resourceType: "user",
      resourceId: targetId,
      outcome: "success",
      ...this.auditCtx(ctx),
    });
    return toPublicUser(updated);
  }
}
