import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CRYPTO_PROVIDERS, TLS_GROUPS, summarizeProfile } from "../../domain/crypto.js";
import { PEER_PROFILES } from "../../domain/policy.js";
import { NotFoundError } from "../../errors.js";
import type { Peer } from "../../repos/peers.js";
import type { TlsProfile } from "../../repos/config.js";
import type { RouteDeps } from "../deps.js";
import { requestMeta, requirePrincipal } from "../guards.js";

/** Accepts a fingerprint as bare hex or as the colon-separated form tools print (AB:CD:...). */
const fingerprint = z
  .string()
  .trim()
  .transform((s) => s.replace(/:/g, "").toLowerCase())
  .pipe(z.string().regex(/^[0-9a-f]{64}$/, "must be a SHA-256 fingerprint (64 hex characters)"));

const createPeerSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,63}$/, "2-64 characters: letters, digits, space, dot, underscore, hyphen"),
  description: z.string().trim().max(300).default(""),
  certSha256: fingerprint,
  profile: z.enum(PEER_PROFILES),
  enabled: z.boolean().default(true),
});

const updatePeerSchema = z
  .object({
    description: z.string().trim().max(300).optional(),
    profile: z.enum(PEER_PROFILES).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "provide at least one field to change");

const createProfileSchema = z.object({
  name: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "lowercase letters, digits and hyphens"),
  description: z.string().trim().min(1).max(300),
  groups: z.array(z.string().min(1).max(40)).min(1).max(4),
});

const setActiveSchema = z.object({ profile: z.string().min(1).max(50), note: z.string().trim().max(300).optional() });
const idParams = z.object({ id: z.uuid() });

function toPeerDTO(p: Peer) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    certSha256: p.certSha256,
    profile: p.profile,
    enabled: p.enabled,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toProfileDTO(p: TlsProfile) {
  return { name: p.name, description: p.description, groups: p.groups, builtin: p.builtin, createdAt: p.createdAt.toISOString(), ...summarizeProfile(p.groups) };
}

/** Peer registry, TLS profile registry, provider registry and the versioned active configuration. */
export function registerConfigRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { guards, peersRepo, configRepo, configService, sidecarsRepo } = deps;

  return async (app) => {
    app.get("/v1/peers", { preHandler: [guards.authenticate, guards.can("peers:read")] }, async () => (await peersRepo.list()).map(toPeerDTO));

    app.post("/v1/peers", { preHandler: [guards.authenticate, guards.can("peers:manage")] }, async (req, reply) => {
      const body = createPeerSchema.parse(req.body);
      const peer = await configService.createPeer(requirePrincipal(req), body, requestMeta(req));
      void reply.status(201).send(toPeerDTO(peer));
    });

    app.patch("/v1/peers/:id", { preHandler: [guards.authenticate, guards.can("peers:manage")] }, async (req) => {
      const { id } = idParams.parse(req.params);
      const patch = updatePeerSchema.parse(req.body);
      const peer = await configService.updatePeer(
        requirePrincipal(req),
        id,
        {
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.profile !== undefined ? { profile: patch.profile } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        },
        requestMeta(req),
      );
      return toPeerDTO(peer);
    });

    app.delete("/v1/peers/:id", { preHandler: [guards.authenticate, guards.can("peers:manage")] }, async (req, reply) => {
      const { id } = idParams.parse(req.params);
      await configService.deletePeer(requirePrincipal(req), id, requestMeta(req));
      void reply.status(204).send();
    });

    app.get("/v1/crypto/groups", { preHandler: [guards.authenticate, guards.can("config:read")] }, async () => Object.values(TLS_GROUPS));

    app.get("/v1/crypto/providers", { preHandler: [guards.authenticate, guards.can("config:read")] }, async () => {
      const sidecars = await sidecarsRepo.list();
      return CRYPTO_PROVIDERS.map((p) => ({
        ...p,
        // What the running sidecar actually reports, next to what the registry declares.
        observed: p.id === "node-openssl" ? (sidecars[0]?.runtime ?? null) : null,
      }));
    });

    app.get("/v1/crypto/profiles", { preHandler: [guards.authenticate, guards.can("config:read")] }, async () => (await configRepo.listProfiles()).map(toProfileDTO));

    app.post("/v1/crypto/profiles", { preHandler: [guards.authenticate, guards.can("config:manage")] }, async (req, reply) => {
      const body = createProfileSchema.parse(req.body);
      const profile = await configService.createProfile(requirePrincipal(req), body, requestMeta(req));
      void reply.status(201).send(toProfileDTO(profile));
    });

    app.get("/v1/crypto/config", { preHandler: [guards.authenticate, guards.can("config:read")] }, async () => {
      const { change, profile, summary } = await configService.describeCurrent();
      const history = await configRepo.listChanges(20);
      const withEffect = await Promise.all(
        history.map(async (c) => {
          const applied = await sidecarsRepo.firstApplied(c.version);
          return {
            version: c.version,
            kind: c.kind,
            summary: c.summary,
            activeProfile: c.activeProfile,
            actorUserId: c.actorUserId,
            actorRole: c.actorRole,
            changedAt: c.createdAt.toISOString(),
            // Experiment E: how long until a running sidecar reported this version applied.
            firstAppliedAt: applied ? applied.appliedAt.toISOString() : null,
            timeToApplyMs: applied ? Math.max(0, applied.appliedAt.getTime() - c.createdAt.getTime()) : null,
          };
        }),
      );
      return {
        version: change.version,
        activeProfile: toProfileDTO(profile),
        changedAt: change.createdAt.toISOString(),
        summary,
        history: withEffect,
      };
    });

    app.post("/v1/crypto/config/active", { preHandler: [guards.authenticate, guards.can("config:manage")] }, async (req) => {
      const body = setActiveSchema.parse(req.body);
      const change = await configService.setActiveProfile(requirePrincipal(req), body.profile, body.note, requestMeta(req));
      const profile = await configRepo.getProfile(change.activeProfile);
      if (!profile) throw new NotFoundError("TLS profile");
      return { version: change.version, activeProfile: toProfileDTO(profile), changedAt: change.createdAt.toISOString() };
    });
  };
}
