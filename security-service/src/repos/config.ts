import type pg from "pg";
import type { Queryable } from "../db/pool.js";
import { ConflictError } from "../errors.js";

export interface TlsProfile {
  name: string;
  description: string;
  groups: string[];
  builtin: boolean;
  createdAt: Date;
}

export interface ConfigChange {
  version: number;
  kind: "initial" | "tls_profile" | "peer" | "profile_registry";
  summary: string;
  activeProfile: string;
  actorUserId: string | null;
  actorRole: string | null;
  createdAt: Date;
}

interface ProfileRow {
  name: string;
  description: string;
  groups: string[];
  builtin: boolean;
  created_at: Date;
}

interface ChangeRow {
  version: string;
  kind: ConfigChange["kind"];
  summary: string;
  active_profile: string;
  actor_user_id: string | null;
  actor_role: string | null;
  created_at: Date;
}

const mapProfile = (r: ProfileRow): TlsProfile => ({
  name: r.name,
  description: r.description,
  groups: r.groups,
  builtin: r.builtin,
  createdAt: r.created_at,
});

const mapChange = (r: ChangeRow): ConfigChange => ({
  version: Number(r.version),
  kind: r.kind,
  summary: r.summary,
  activeProfile: r.active_profile,
  actorUserId: r.actor_user_id,
  actorRole: r.actor_role,
  createdAt: r.created_at,
});

export class ConfigRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listProfiles(db: Queryable = this.pool): Promise<TlsProfile[]> {
    const { rows } = await db.query<ProfileRow>("SELECT * FROM tls_profiles ORDER BY builtin DESC, name");
    return rows.map(mapProfile);
  }

  async getProfile(name: string, db: Queryable = this.pool): Promise<TlsProfile | null> {
    const { rows } = await db.query<ProfileRow>("SELECT * FROM tls_profiles WHERE name = $1", [name]);
    return rows[0] ? mapProfile(rows[0]) : null;
  }

  async createProfile(db: Queryable, input: { name: string; description: string; groups: string[] }): Promise<TlsProfile> {
    try {
      const { rows } = await db.query<ProfileRow>(
        "INSERT INTO tls_profiles (name, description, groups) VALUES ($1, $2, $3) RETURNING *",
        [input.name, input.description, input.groups],
      );
      return mapProfile(rows[0]!);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictError(`A profile named ${input.name} already exists`, "PROFILE_CONFLICT");
      }
      throw err;
    }
  }

  /** The latest change row: its version is the current configuration revision. */
  async current(db: Queryable = this.pool): Promise<ConfigChange> {
    const { rows } = await db.query<ChangeRow>("SELECT * FROM config_changes ORDER BY version DESC LIMIT 1");
    return mapChange(rows[0]!);
  }

  /** Appends a change row. `activeProfile` defaults to whatever is active now. */
  async appendChange(
    db: Queryable,
    input: { kind: ConfigChange["kind"]; summary: string; activeProfile?: string; actorUserId?: string | null; actorRole?: string | null },
  ): Promise<ConfigChange> {
    const active = input.activeProfile ?? (await this.current(db)).activeProfile;
    const { rows } = await db.query<ChangeRow>(
      `INSERT INTO config_changes (kind, summary, active_profile, actor_user_id, actor_role)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.kind, input.summary, active, input.actorUserId ?? null, input.actorRole ?? null],
    );
    return mapChange(rows[0]!);
  }

  async listChanges(limit: number): Promise<ConfigChange[]> {
    const { rows } = await this.pool.query<ChangeRow>("SELECT * FROM config_changes ORDER BY version DESC LIMIT $1", [limit]);
    return rows.map(mapChange);
  }
}
