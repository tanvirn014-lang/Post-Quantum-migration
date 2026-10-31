import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { hasPermission, type Permission } from "../auth/permissions.js";
import type { Principal, TokenVerifier } from "../auth/verifier.js";
import { AuthenticationRequiredError, ForbiddenError, InvalidServiceTokenError } from "../errors.js";
import type { AuditLog } from "../repos/audit.js";
import type { RequestMeta } from "../services/config-service.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
    servicePrincipal: string | null;
  }
}

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function requestMeta(req: FastifyRequest): RequestMeta {
  return { ip: req.ip, userAgent: req.headers["user-agent"], correlationId: req.id };
}

/** Compares in constant time without leaking length: both sides are hashed first. */
function tokensEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export interface Guards {
  authenticate: Guard;
  can(permission: Permission): Guard;
  /** Machine-to-machine: requires `Authorization: Bearer <token>` equal to the principal's token. */
  service(principal: string, expectedToken: () => string | undefined): Guard;
}

export function createGuards(verifier: TokenVerifier, audit: AuditLog): Guards {
  const authenticate: Guard = async (req) => {
    const header = req.headers.authorization;
    const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header) : null;
    if (!match) throw new AuthenticationRequiredError();
    req.principal = await verifier.verify(match[1]!);
  };

  const can = (permission: Permission): Guard => async (req) => {
    const principal = req.principal;
    if (!principal) throw new AuthenticationRequiredError();
    if (hasPermission(principal.role, permission)) return;
    await audit.record({
      actorUserId: principal.userId,
      actorRole: principal.role,
      action: "authz.denied",
      outcome: "denied",
      ...requestMeta(req),
      resourceType: "route",
      resourceId: `${req.method} ${req.routeOptions.url ?? req.url}`,
      details: { permission },
    });
    throw new ForbiddenError();
  };

  const service = (principal: string, expectedToken: () => string | undefined): Guard => async (req) => {
    const header = req.headers.authorization;
    const match = typeof header === "string" ? /^Bearer (.+)$/.exec(header) : null;
    const expected = expectedToken();
    if (!match || !expected || !tokensEqual(match[1]!, expected)) throw new InvalidServiceTokenError();
    req.servicePrincipal = principal;
  };

  return { authenticate, can, service };
}

export function requirePrincipal(req: FastifyRequest): Principal {
  if (!req.principal) throw new AuthenticationRequiredError();
  return req.principal;
}
