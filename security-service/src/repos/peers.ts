import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Queryable } from "../db/pool.js";
import type { PeerProfile } from "../domain/policy.js";
import { ConflictError } from "../errors.js";

export interface Peer {
  id: string;
  name: string;
  description: string;
  certSha256: string;
  profile: PeerProfile;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PeerRow {
  id: string;
  name: string;
  description: string;
  cert_sha256: string;
  profile: PeerProfile;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

const mapPeer = (r: PeerRow): Peer => ({
  id: r.id,
  name: r.name,
  description: r.description,
  certSha256: r.cert_sha256,
  profile: r.profile,
  enabled: r.enabled,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function translateUnique(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === "23505") {
    if (e.constraint?.includes("cert_sha256")) {
      throw new ConflictError("A peer with that certificate fingerprint is already registered", "PEER_CERT_CONFLICT");
    }
    throw new ConflictError("A peer with that name already exists", "PEER_NAME_CONFLICT");
  }
  throw err;
}

export interface NewPeer {
  name: string;
  description: string;
  certSha256: string;
  profile: PeerProfile;
  enabled: boolean;
}

export class PeerRepository {
  constructor(private readonly pool: pg.Pool) {}

  async list(db: Queryable = this.pool): Promise<Peer[]> {
    const { rows } = await db.query<PeerRow>("SELECT * FROM peers ORDER BY name");
    return rows.map(mapPeer);
  }

  async get(id: string, db: Queryable = this.pool): Promise<Peer | null> {
    const { rows } = await db.query<PeerRow>("SELECT * FROM peers WHERE id = $1", [id]);
    return rows[0] ? mapPeer(rows[0]) : null;
  }

  async create(db: Queryable, input: NewPeer): Promise<Peer> {
    try {
      const { rows } = await db.query<PeerRow>(
        `INSERT INTO peers (id, name, description, cert_sha256, profile, enabled)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [randomUUID(), input.name, input.description, input.certSha256, input.profile, input.enabled],
      );
      return mapPeer(rows[0]!);
    } catch (err) {
      return translateUnique(err);
    }
  }

  async update(db: Queryable, id: string, patch: Partial<Pick<Peer, "description" | "profile" | "enabled">>): Promise<Peer | null> {
    const { rows } = await db.query<PeerRow>(
      `UPDATE peers SET
         description = COALESCE($2, description),
         profile = COALESCE($3, profile),
         enabled = COALESCE($4, enabled),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, patch.description ?? null, patch.profile ?? null, patch.enabled ?? null],
    );
    return rows[0] ? mapPeer(rows[0]) : null;
  }

  async delete(db: Queryable, id: string): Promise<Peer | null> {
    const { rows } = await db.query<PeerRow>("DELETE FROM peers WHERE id = $1 RETURNING *", [id]);
    return rows[0] ? mapPeer(rows[0]) : null;
  }
}
