import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { COMPONENTS } from "../../domain/status.js";
import { DECISIONS, KEY_EXCHANGES } from "../../domain/policy.js";
import { NotFoundError } from "../../errors.js";
import type { AuditEvent } from "../../audit/chain.js";
import { withTransaction } from "../../db/pool.js";
import type { ConnectionEvent } from "../../repos/telemetry.js";
import type { RouteDeps } from "../deps.js";
import { requestMeta, requirePrincipal } from "../guards.js";

const limit = (max: number, fallback: number) => z.coerce.number().int().min(1).max(max).default(fallback);
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

const connectionsQuery = z.object({
  limit: limit(200, 50),
  before: z.iso.datetime().optional(),
  decision: z.enum(DECISIONS).optional(),
  keyExchange: z.enum(KEY_EXCHANGES).optional(),
  peerId: z.uuid().optional(),
  alertsOnly: boolQuery.optional(),
});
const alertsQuery = z.object({ limit: limit(200, 50), includeAcknowledged: boolQuery.optional() });
const summaryQuery = z.object({ hours: z.coerce.number().int().min(1).max(24 * 30).default(24) });
const auditQuery = z.object({
  limit: limit(200, 50),
  beforeSeq: z.coerce.number().int().positive().optional(),
  action: z.string().min(1).max(64).optional(),
  outcome: z.enum(["success", "denied", "failure"]).optional(),
});
const ackSchema = z.object({ note: z.string().trim().max(300).optional() });
const idParams = z.object({ id: z.uuid() });

function toEventDTO(e: ConnectionEvent) {
  return {
    id: e.id,
    correlationId: e.correlationId,
    occurredAt: e.occurredAt.toISOString(),
    remoteAddr: e.remoteAddr,
    peerId: e.peerId,
    peerName: e.peerName,
    certSha256: e.certSha256,
    expectedProfile: e.expectedProfile,
    tlsVersion: e.tlsVersion,
    cipher: e.cipher,
    offeredGroups: e.offeredGroups,
    negotiatedGroup: e.negotiatedGroup,
    negotiatedGroupCode: e.negotiatedGroupCode,
    keyExchange: e.keyExchange,
    clientKeyShareBytes: e.clientKeyShareBytes,
    serverKeyShareBytes: e.serverKeyShareBytes,
    decision: e.decision,
    severity: e.severity,
    reason: e.reason,
    handshakeMs: e.handshakeMs,
    configVersion: e.configVersion,
    requestsForwarded: e.requestsForwarded,
    acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: e.acknowledgedBy,
    ackNote: e.ackNote,
  };
}

function toAuditDTO(e: AuditEvent) {
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

/** Read APIs for telemetry, alerts, overview, implementation status and the config audit log. */
export function registerTelemetryRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { guards, telemetryRepo, audit, pool, sidecarsRepo, configService, peersRepo, config } = deps;

  return async (app) => {
    app.get("/v1/telemetry/connections", { preHandler: [guards.authenticate, guards.can("telemetry:read")] }, async (req) => {
      const q = connectionsQuery.parse(req.query);
      const events = await telemetryRepo.list({
        limit: q.limit,
        before: q.before ? new Date(q.before) : undefined,
        decision: q.decision,
        keyExchange: q.keyExchange,
        peerId: q.peerId,
        alertsOnly: q.alertsOnly,
      });
      const last = events[events.length - 1];
      return { events: events.map(toEventDTO), nextBefore: events.length === q.limit && last ? last.occurredAt.toISOString() : null };
    });

    app.get("/v1/telemetry/summary", { preHandler: [guards.authenticate, guards.can("telemetry:read")] }, async (req) => {
      const { hours } = summaryQuery.parse(req.query);
      return telemetryRepo.summary(hours);
    });

    app.get("/v1/telemetry/alerts", { preHandler: [guards.authenticate, guards.can("telemetry:read")] }, async (req) => {
      const q = alertsQuery.parse(req.query);
      const events = await telemetryRepo.list({ limit: q.limit, alertsOnly: true, unacknowledgedOnly: !q.includeAcknowledged });
      return events.map(toEventDTO);
    });

    app.post("/v1/telemetry/alerts/:id/acknowledge", { preHandler: [guards.authenticate, guards.can("alerts:acknowledge")] }, async (req) => {
      const { id } = idParams.parse(req.params);
      const { note } = ackSchema.parse(req.body ?? {});
      const principal = requirePrincipal(req);
      return withTransaction(pool, async (client) => {
        const event = await telemetryRepo.acknowledge(client, id, principal.userId, note ?? null);
        if (!event) throw new NotFoundError("Alert");
        await audit.recordIn(client, {
          actorUserId: principal.userId,
          actorRole: principal.role,
          action: "alert.acknowledge",
          resourceType: "connection_event",
          resourceId: id,
          outcome: "success",
          ...requestMeta(req),
          details: { decision: event.decision, severity: event.severity, note: note ?? null },
        });
        return toEventDTO(event);
      });
    });

    app.get("/v1/overview", { preHandler: [guards.authenticate, guards.can("overview:read")] }, async () => {
      const [current, sidecars, summary, peers] = await Promise.all([
        configService.describeCurrent(),
        sidecarsRepo.list(),
        telemetryRepo.summary(24),
        peersRepo.list(),
      ]);
      const now = Date.now();
      return {
        config: {
          version: current.change.version,
          profile: current.profile.name,
          groups: current.profile.groups,
          summary: current.summary.summary,
          changedAt: current.change.createdAt.toISOString(),
        },
        sidecars: sidecars.map((s) => {
          const ageSeconds = Math.round((now - s.lastSeenAt.getTime()) / 1000);
          return {
            instanceId: s.instanceId,
            startedAt: s.startedAt.toISOString(),
            lastSeenAt: s.lastSeenAt.toISOString(),
            ageSeconds,
            stale: ageSeconds > config.sidecarStaleSeconds,
            appliedConfigVersion: s.appliedConfigVersion,
            inSync: s.appliedConfigVersion === current.change.version,
            activeProfile: s.activeProfile,
            runtime: s.runtime,
            listener: s.listener,
            counters: s.counters,
          };
        }),
        peers: { total: peers.length, enabled: peers.filter((p) => p.enabled).length, hybridRequired: peers.filter((p) => p.profile === "hybrid-required").length },
        telemetry: summary,
      };
    });

    app.get("/v1/status/components", { preHandler: [guards.authenticate, guards.can("overview:read")] }, async () => COMPONENTS);

    app.get("/v1/audit/events", { preHandler: [guards.authenticate, guards.can("audit:read")] }, async (req) => {
      const q = auditQuery.parse(req.query);
      const events = await audit.list({
        limit: q.limit,
        ...(q.beforeSeq !== undefined ? { beforeSeq: q.beforeSeq } : {}),
        ...(q.action !== undefined ? { action: q.action } : {}),
        ...(q.outcome !== undefined ? { outcome: q.outcome } : {}),
      });
      const last = events[events.length - 1];
      return { events: events.map(toAuditDTO), nextBeforeSeq: events.length === q.limit && last ? last.seq : null };
    });

    app.get("/v1/audit/verify", { preHandler: [guards.authenticate, guards.can("audit:verify")] }, async (req) => {
      const principal = requirePrincipal(req);
      const result = await audit.verify();
      await audit.record({
        actorUserId: principal.userId,
        actorRole: principal.role,
        action: "audit.verify",
        outcome: result.valid ? "success" : "failure",
        ...requestMeta(req),
        details: { eventsChecked: result.eventsChecked, brokenAtSeq: result.brokenAtSeq },
      });
      return result;
    });
  };
}
