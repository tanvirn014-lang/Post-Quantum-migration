import { randomUUID } from "node:crypto";
import type pg from "pg";
import { GENESIS_HASH, computeAuditHash, type AuditEvent, type AuditOutcome, type NewAuditEvent } from "../../audit/chain.js";

export interface AuditRow {
  seq: string;
  id: string;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  user_agent: string | null;
  correlation_id: string | null;
  details: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export const mapAuditRow = (r: AuditRow): AuditEvent => ({
  seq: Number(r.seq),
  id: r.id,
  occurredAt: r.occurred_at,
  actorUserId: r.actor_user_id,
  actorRole: r.actor_role,
  action: r.action,
  resourceType: r.resource_type,
  resourceId: r.resource_id,
  outcome: r.outcome,
  ip: r.ip,
  userAgent: r.user_agent,
  correlationId: r.correlation_id,
  details: r.details,
  prevHash: r.prev_hash,
  hash: r.hash,
});

// Arbitrary constant naming the audit chain's advisory lock. Held for the duration of the
// append transaction so concurrent writers cannot both link to the same previous hash.
export const AUDIT_CHAIN_LOCK = 7_240_001;

/**
 * Appends one event to the hash chain using the CALLER'S client and transaction, holding the
 * chain advisory lock so concurrent writers cannot link to the same previous hash. Because the
 * caller owns BEGIN/COMMIT, a financial posting and its audit entry can be written in a single
 * transaction - either both commit or neither does. The standalone AuditStore.append wraps this
 * in its own transaction for events that are not tied to a posting (auth, config).
 */
export async function appendAuditEventInTx(client: pg.PoolClient, input: NewAuditEvent, occurredAt: Date): Promise<AuditEvent> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_CHAIN_LOCK]);
  const { rows: headRows } = await client.query<{ hash: string }>("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1");
  const prevHash = headRows[0]?.hash ?? GENESIS_HASH;
  const partial = {
    id: randomUUID(),
    occurredAt,
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    correlationId: input.correlationId ?? null,
    details: JSON.parse(JSON.stringify(input.details ?? {})) as Record<string, unknown>,
  };
  const hash = computeAuditHash(prevHash, partial);
  const { rows } = await client.query<AuditRow>(
    `INSERT INTO audit_events
       (id, occurred_at, actor_user_id, actor_role, action, resource_type, resource_id, outcome,
        ip, user_agent, correlation_id, details, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      partial.id,
      occurredAt,
      partial.actorUserId,
      partial.actorRole,
      partial.action,
      partial.resourceType,
      partial.resourceId,
      partial.outcome,
      partial.ip,
      partial.userAgent,
      partial.correlationId,
      JSON.stringify(partial.details),
      prevHash,
      hash,
    ],
  );
  return mapAuditRow(rows[0]!);
}
