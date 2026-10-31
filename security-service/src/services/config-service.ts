import type pg from "pg";
import { withTransaction } from "../db/pool.js";
import { summarizeProfile, validateProfileGroups, type ProfileSummary } from "../domain/crypto.js";
import type { PeerProfile } from "../domain/policy.js";
import { ConflictError, NotFoundError, ValidationFailedError } from "../errors.js";
import type { AuditLog } from "../repos/audit.js";
import type { ConfigChange, ConfigRepository, TlsProfile } from "../repos/config.js";
import type { NewPeer, Peer, PeerRepository } from "../repos/peers.js";

export interface Actor {
  userId: string;
  role: string;
}

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  correlationId?: string | undefined;
}

export interface SidecarConfig {
  /** Monotonic revision; bumps on every change to the active profile or the peer registry. */
  version: number;
  tlsProfile: { name: string; groups: string[]; description: string };
  peers: { id: string; name: string; certSha256: string; profile: PeerProfile; enabled: boolean }[];
  generatedAt: string;
}

function meta(m: RequestMeta) {
  return { ip: m.ip ?? null, userAgent: m.userAgent ?? null, correlationId: m.correlationId ?? null };
}

/**
 * Owns every change to what the sidecar enforces. Each change appends a config version and a
 * hash-chained audit entry in ONE database transaction, so there is never a configuration
 * change without a matching audit record, nor an audit record for a change that rolled back.
 */
export class ConfigService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: ConfigRepository,
    private readonly peers: PeerRepository,
    private readonly audit: AuditLog,
  ) {}

  /** A consistent snapshot (one repeatable-read transaction) of what the sidecar should enforce. */
  async getSidecarConfig(): Promise<SidecarConfig> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const current = await this.config.current(client);
      const profile = await this.config.getProfile(current.activeProfile, client);
      const peers = await this.peers.list(client);
      await client.query("COMMIT");
      if (!profile) throw new Error(`Active profile ${current.activeProfile} is missing from the registry`);
      return {
        version: current.version,
        tlsProfile: { name: profile.name, groups: profile.groups, description: profile.description },
        peers: peers.map((p) => ({ id: p.id, name: p.name, certSha256: p.certSha256, profile: p.profile, enabled: p.enabled })),
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async describeCurrent(): Promise<{ change: ConfigChange; profile: TlsProfile; summary: ProfileSummary }> {
    const change = await this.config.current();
    const profile = await this.config.getProfile(change.activeProfile);
    if (!profile) throw new Error(`Active profile ${change.activeProfile} is missing from the registry`);
    return { change, profile, summary: summarizeProfile(profile.groups) };
  }

  async setActiveProfile(actor: Actor, name: string, note: string | undefined, m: RequestMeta): Promise<ConfigChange> {
    return withTransaction(this.pool, async (client) => {
      const profile = await this.config.getProfile(name, client);
      if (!profile) throw new NotFoundError(`TLS profile ${name}`);
      const current = await this.config.current(client);
      if (current.activeProfile === name) throw new ConflictError(`Profile ${name} is already active`, "PROFILE_ALREADY_ACTIVE");
      const change = await this.config.appendChange(client, {
        kind: "tls_profile",
        summary: `Active TLS profile changed from ${current.activeProfile} to ${name}${note ? `: ${note}` : ""}`,
        activeProfile: name,
        actorUserId: actor.userId,
        actorRole: actor.role,
      });
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "config.tls_profile.set",
        resourceType: "tls_profile",
        resourceId: name,
        outcome: "success",
        ...meta(m),
        details: { from: current.activeProfile, to: name, groups: profile.groups, configVersion: change.version, note: note ?? null },
      });
      return change;
    });
  }

  async createProfile(actor: Actor, input: { name: string; description: string; groups: string[] }, m: RequestMeta): Promise<TlsProfile> {
    const problems = validateProfileGroups(input.groups);
    if (problems.length > 0) throw new ValidationFailedError("Profile is not acceptable for the crypto provider", { problems });
    return withTransaction(this.pool, async (client) => {
      const profile = await this.config.createProfile(client, input);
      const change = await this.config.appendChange(client, {
        kind: "profile_registry",
        summary: `TLS profile ${profile.name} added to the registry (${profile.groups.join(", ")})`,
        actorUserId: actor.userId,
        actorRole: actor.role,
      });
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "config.tls_profile.create",
        resourceType: "tls_profile",
        resourceId: profile.name,
        outcome: "success",
        ...meta(m),
        details: { groups: profile.groups, configVersion: change.version },
      });
      return profile;
    });
  }

  async createPeer(actor: Actor, input: NewPeer, m: RequestMeta): Promise<Peer> {
    return withTransaction(this.pool, async (client) => {
      const peer = await this.peers.create(client, input);
      const change = await this.config.appendChange(client, {
        kind: "peer",
        summary: `Peer ${peer.name} registered with profile ${peer.profile}`,
        actorUserId: actor.userId,
        actorRole: actor.role,
      });
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "peer.create",
        resourceType: "peer",
        resourceId: peer.id,
        outcome: "success",
        ...meta(m),
        details: { name: peer.name, profile: peer.profile, certSha256: peer.certSha256, enabled: peer.enabled, configVersion: change.version },
      });
      return peer;
    });
  }

  async updatePeer(
    actor: Actor,
    id: string,
    patch: Partial<Pick<Peer, "description" | "profile" | "enabled">>,
    m: RequestMeta,
  ): Promise<Peer> {
    return withTransaction(this.pool, async (client) => {
      const before = await this.peers.get(id, client);
      if (!before) throw new NotFoundError("Peer");
      const after = await this.peers.update(client, id, patch);
      if (!after) throw new NotFoundError("Peer");
      const changes: string[] = [];
      if (patch.profile !== undefined && patch.profile !== before.profile) changes.push(`profile ${before.profile} -> ${after.profile}`);
      if (patch.enabled !== undefined && patch.enabled !== before.enabled) changes.push(after.enabled ? "enabled" : "disabled");
      if (patch.description !== undefined && patch.description !== before.description) changes.push("description updated");
      const enforcementChanged = before.profile !== after.profile || before.enabled !== after.enabled;
      const change = enforcementChanged
        ? await this.config.appendChange(client, {
            kind: "peer",
            summary: `Peer ${after.name}: ${changes.join(", ")}`,
            actorUserId: actor.userId,
            actorRole: actor.role,
          })
        : null;
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "peer.update",
        resourceType: "peer",
        resourceId: id,
        outcome: "success",
        ...meta(m),
        details: {
          name: after.name,
          before: { profile: before.profile, enabled: before.enabled },
          after: { profile: after.profile, enabled: after.enabled },
          configVersion: change?.version ?? null,
        },
      });
      return after;
    });
  }

  async deletePeer(actor: Actor, id: string, m: RequestMeta): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const peer = await this.peers.delete(client, id);
      if (!peer) throw new NotFoundError("Peer");
      const change = await this.config.appendChange(client, {
        kind: "peer",
        summary: `Peer ${peer.name} removed from the registry`,
        actorUserId: actor.userId,
        actorRole: actor.role,
      });
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "peer.delete",
        resourceType: "peer",
        resourceId: id,
        outcome: "success",
        ...meta(m),
        details: { name: peer.name, certSha256: peer.certSha256, configVersion: change.version },
      });
    });
  }
}
