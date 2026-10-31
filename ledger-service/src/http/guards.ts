import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditService } from "../app/audit-service.js";
import type { IdentityService, RequestContext } from "../app/identity-service.js";
import { AuthenticationRequiredError, ForbiddenError, PasswordChangeRequiredError } from "../identity/errors.js";
import { hasPermission, type Permission } from "../identity/roles.js";
import type { User } from "../identity/types.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the authenticate guard. Null on public routes. */
    authUser: User | null;
  }
  interface FastifyContextConfig {
    /** Routes a user may call even while a password change is pending. */
    allowWhilePasswordChangeRequired?: boolean;
  }
}

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function requestContext(req: FastifyRequest): RequestContext {
  return { ip: req.ip, userAgent: req.headers["user-agent"], correlationId: req.id };
}

export interface Guards {
  /** Requires a valid bearer token for an active user. */
  authenticate: Guard;
  /** Requires the authenticated user's role to hold `permission`; denials are audited. */
  can(permission: Permission): Guard;
  /** Passes if the role holds at least one of the permissions. */
  canAny(...permissions: Permission[]): Guard;
}

export function createGuards(identity: IdentityService, audit: AuditService): Guards {
  const authenticate: Guard = async (req) => {
    const header = req.headers.authorization;
    const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header) : null;
    if (!match) throw new AuthenticationRequiredError();
    const user = await identity.authenticate(match[1]!);
    req.authUser = user;
    if (user.mustChangePassword && !req.routeOptions.config.allowWhilePasswordChangeRequired) {
      throw new PasswordChangeRequiredError();
    }
  };

  const denyUnless = (permissions: Permission[]): Guard => async (req) => {
    const user = req.authUser;
    if (!user) throw new AuthenticationRequiredError();
    if (permissions.some((p) => hasPermission(user.role, p))) return;
    await audit.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: "authz.denied",
      outcome: "denied",
      ...requestContext(req),
      resourceType: "route",
      resourceId: `${req.method} ${req.routeOptions.url ?? req.url}`,
      details: { permission: permissions.join("|") },
    });
    throw new ForbiddenError();
  };

  return { authenticate, can: (permission) => denyUnless([permission]), canAny: (...permissions) => denyUnless(permissions) };
}

export function requireUser(req: FastifyRequest): User {
  if (!req.authUser) throw new AuthenticationRequiredError();
  return req.authUser;
}
