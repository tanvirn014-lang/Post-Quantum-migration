import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { DECISIONS, KEY_EXCHANGES, PEER_PROFILES } from "../../domain/policy.js";
import type { ConnectionEventInput } from "../../repos/telemetry.js";
import type { RouteDeps } from "../deps.js";

const eventSchema = z.object({
  id: z.uuid(),
  correlationId: z.string().min(1).max(64),
  occurredAt: z.iso.datetime(),
  remoteAddr: z.string().max(64).optional(),
  peerId: z.uuid().optional(),
  peerName: z.string().max(64).optional(),
  certSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  expectedProfile: z.enum(PEER_PROFILES).optional(),
  tlsVersion: z.string().max(16).optional(),
  cipher: z.string().max(64).optional(),
  offeredGroups: z.array(z.object({ code: z.number().int().min(0).max(65535), name: z.string().max(40).optional() })).max(32).default([]),
  negotiatedGroup: z.string().max(40).optional(),
  negotiatedGroupCode: z.number().int().min(0).max(65535).optional(),
  keyExchange: z.enum(KEY_EXCHANGES),
  clientKeyShareBytes: z.number().int().min(0).max(100_000).optional(),
  serverKeyShareBytes: z.number().int().min(0).max(100_000).optional(),
  decision: z.enum(DECISIONS),
  reason: z.string().min(1).max(300),
  handshakeMs: z.number().min(0).max(600_000).optional(),
  configVersion: z.number().int().min(1),
  requestsForwarded: z.number().int().min(0).optional(),
});

const eventsBody = z.object({ events: z.array(eventSchema).min(1).max(100) });

const heartbeatSchema = z.object({
  instanceId: z.string().min(1).max(64),
  startedAt: z.iso.datetime(),
  appliedConfigVersion: z.number().int().min(1),
  activeProfile: z.string().min(1).max(50),
  runtime: z.record(z.string(), z.unknown()).default({}),
  listener: z.record(z.string(), z.unknown()).default({}),
  counters: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Machine-to-machine API for the sidecar: pull configuration (conditional GET on a version
 * ETag), push connection telemetry, report heartbeats. Authenticated by the sidecar's own
 * service token, which grants nothing else.
 */
export function registerInternalRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { guards, configService, telemetryRepo, sidecarsRepo, config } = deps;
  const sidecarOnly = guards.service("sidecar", () => config.sidecarToken);

  return async (app) => {
    app.get("/internal/v1/sidecar-config", { preHandler: [sidecarOnly] }, async (req, reply) => {
      const snapshot = await configService.getSidecarConfig();
      const etag = `"v${snapshot.version}"`;
      void reply.header("etag", etag).header("cache-control", "no-cache");
      if (req.headers["if-none-match"] === etag) {
        void reply.status(304).send();
        return;
      }
      void reply.send(snapshot);
    });

    app.post("/internal/v1/events/connections", { preHandler: [sidecarOnly] }, async (req, reply) => {
      const { events } = eventsBody.parse(req.body);
      const inputs: ConnectionEventInput[] = events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) }));
      const accepted = await telemetryRepo.insertConnections(inputs);
      void reply.status(202).send({ received: events.length, accepted });
    });

    app.post("/internal/v1/sidecar/heartbeat", { preHandler: [sidecarOnly] }, async (req, reply) => {
      const hb = heartbeatSchema.parse(req.body);
      await sidecarsRepo.heartbeat({ ...hb, startedAt: new Date(hb.startedAt) });
      void reply.status(204).send();
    });
  };
}
