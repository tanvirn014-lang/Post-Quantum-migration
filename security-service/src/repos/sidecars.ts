import type pg from "pg";

export interface SidecarHeartbeat {
  instanceId: string;
  startedAt: Date;
  appliedConfigVersion: number;
  activeProfile: string;
  runtime: Record<string, unknown>;
  listener: Record<string, unknown>;
  counters: Record<string, unknown>;
}

export interface SidecarInstance extends SidecarHeartbeat {
  lastSeenAt: Date;
}

interface InstanceRow {
  instance_id: string;
  started_at: Date;
  last_seen_at: Date;
  applied_config_version: string;
  active_profile: string;
  runtime: Record<string, unknown>;
  listener: Record<string, unknown>;
  counters: Record<string, unknown>;
}

const mapInstance = (r: InstanceRow): SidecarInstance => ({
  instanceId: r.instance_id,
  startedAt: r.started_at,
  lastSeenAt: r.last_seen_at,
  appliedConfigVersion: Number(r.applied_config_version),
  activeProfile: r.active_profile,
  runtime: r.runtime,
  listener: r.listener,
  counters: r.counters,
});

export interface ConfigApplication {
  instanceId: string;
  configVersion: number;
  profile: string;
  appliedAt: Date;
}

export class SidecarRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** Records the heartbeat and, when the applied version moved, one application record. */
  async heartbeat(hb: SidecarHeartbeat): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: prev } = await client.query<{ applied_config_version: string }>(
        "SELECT applied_config_version FROM sidecar_instances WHERE instance_id = $1 FOR UPDATE",
        [hb.instanceId],
      );
      await client.query(
        `INSERT INTO sidecar_instances
           (instance_id, started_at, last_seen_at, applied_config_version, active_profile, runtime, listener, counters)
         VALUES ($1, $2, now(), $3, $4, $5, $6, $7)
         ON CONFLICT (instance_id) DO UPDATE SET
           last_seen_at = now(), applied_config_version = EXCLUDED.applied_config_version,
           active_profile = EXCLUDED.active_profile, runtime = EXCLUDED.runtime,
           listener = EXCLUDED.listener, counters = EXCLUDED.counters`,
        [hb.instanceId, hb.startedAt, hb.appliedConfigVersion, hb.activeProfile, JSON.stringify(hb.runtime), JSON.stringify(hb.listener), JSON.stringify(hb.counters)],
      );
      if (!prev[0] || Number(prev[0].applied_config_version) !== hb.appliedConfigVersion) {
        await client.query(
          "INSERT INTO config_applications (instance_id, config_version, profile, applied_at) VALUES ($1, $2, $3, now())",
          [hb.instanceId, hb.appliedConfigVersion, hb.activeProfile],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async list(): Promise<SidecarInstance[]> {
    const { rows } = await this.pool.query<InstanceRow>("SELECT * FROM sidecar_instances ORDER BY last_seen_at DESC");
    return rows.map(mapInstance);
  }

  /** When did any sidecar first report running `version` (or later)? Used for time-to-effect. */
  async firstApplied(version: number): Promise<ConfigApplication | null> {
    const { rows } = await this.pool.query<{ instance_id: string; config_version: string; profile: string; applied_at: Date }>(
      "SELECT * FROM config_applications WHERE config_version >= $1 ORDER BY applied_at ASC LIMIT 1",
      [version],
    );
    const r = rows[0];
    return r ? { instanceId: r.instance_id, configVersion: Number(r.config_version), profile: r.profile, appliedAt: r.applied_at } : null;
  }
}
