import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AuditEvent } from "../../audit/chain.js";
import type { RouteDeps } from "../deps.js";
import { requestContext, requireUser } from "../guards.js";
import { limitQuery } from "../schemas.js";

const querySchema = z.object({
  limit: limitQuery(200, 50),
  beforeSeq: z.coerce.number().int().positive().optional(),
  action: z.string().min(1).max(64).optional(),
  actorUserId: z.uuid().optional(),
  outcome: z.enum(["success", "denied", "failure"]).optional(),
});

function toAuditEventDTO(e: AuditEvent) {
  return {
    seq: e.seq,
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    actorUserId: e.actorUserId,
    actorRole: e.actorRole,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    outcome: e.outcome,
    ip: e.ip,
    correlationId: e.correlationId,
    details: e.details,
    hash: e.hash,
  };
}

export function registerAuditRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { audit, guards } = deps;

  return async (app) => {
    app.get("/audit/events", { preHandler: [guards.authenticate, guards.can("audit:read")] }, async (req) => {
      const q = querySchema.parse(req.query);
      const events = await audit.list({
        limit: q.limit,
        ...(q.beforeSeq !== undefined ? { beforeSeq: q.beforeSeq } : {}),
        ...(q.action !== undefined ? { action: q.action } : {}),
        ...(q.actorUserId !== undefined ? { actorUserId: q.actorUserId } : {}),
        ...(q.outcome !== undefined ? { outcome: q.outcome } : {}),
      });
      const last = events[events.length - 1];
      return { events: events.map(toAuditEventDTO), nextBeforeSeq: events.length === q.limit && last ? last.seq : null };
    });

    app.get("/audit/verify", { preHandler: [guards.authenticate, guards.can("audit:verify")] }, async (req) => {
      const user = requireUser(req);
      const result = await audit.verify();
      await audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: "audit.verify",
        outcome: result.valid ? "success" : "failure",
        ...requestContext(req),
        details: { eventsChecked: result.eventsChecked, brokenAtSeq: result.brokenAtSeq },
      });
      return result;
    });
  };
}
