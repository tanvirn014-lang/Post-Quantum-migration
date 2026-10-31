import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  GENESIS_HASH,
  computeAuditHash,
  verifyEvents,
  type AuditEvent,
  type AuditOutcome,
  type ChainVerification,
  type NewAuditEvent,
} from "../audit/chain.js";
import { withTransaction } from "../db/pool.js";

interface AuditRow {
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

const mapRow = (r: AuditRow): AuditEvent => ({
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

// Names the audit chain advisory lock; held for the append transaction so writers serialize.
const AUDIT_CHAIN_LOCK = 7_240_002;
const VERIFY_PAGE_SIZE = 500;

export interface AuditListOptions {
  limit: number;
  beforeSeq?: number;
  action?: string;
  outcome?: AuditOutcome;
}

export class AuditLog {
  constructor(
    private readonly pool: pg.Pool,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Appends within the caller's transaction, so a configuration change and its audit entry
   *  commit or roll back together. */
  async recordIn(client: pg.PoolClient, input: NewAuditEvent): Promise<AuditEvent> {
    await client.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_CHAIN_LOCK]);
    const { rows: head } = await client.query<{ hash: string }>("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1");
    const prevHash = head[0]?.hash ?? GENESIS_HASH;
    const occurredAt = this.clock();
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
        computeAuditHash(prevHash, partial),
      ],
    );
    return mapRow(rows[0]!);
  }

  /** Appends in its own transaction (for events with no accompanying data change, e.g. denials). */
  record(input: NewAuditEvent): Promise<AuditEvent> {
    return withTransaction(this.pool, (client) => this.recordIn(client, input));
  }

  async list(opts: AuditListOptions): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_events
       WHERE ($1::bigint IS NULL OR seq < $1)
         AND ($2::text IS NULL OR action = $2)
         AND ($3::text IS NULL OR outcome = $3)
       ORDER BY seq DESC LIMIT $4`,
      [opts.beforeSeq ?? null, opts.action ?? null, opts.outcome ?? null, opts.limit],
    );
    return rows.map(mapRow);
  }

  async verify(): Promise<ChainVerification> {
    let afterSeq = 0;
    let prevHash = GENESIS_HASH;
    let checked = 0;
    for (;;) {
      const { rows } = await this.pool.query<AuditRow>("SELECT * FROM audit_events WHERE seq > $1 ORDER BY seq ASC LIMIT $2", [
        afterSeq,
        VERIFY_PAGE_SIZE,
      ]);
      if (rows.length === 0) break;
      const page = rows.map(mapRow);
      const result = verifyEvents(page, prevHash);
      if (!result.ok) return { valid: false, eventsChecked: checked, brokenAtSeq: result.seq, reason: result.reason, headHash: prevHash };
      prevHash = result.headHash;
      checked += page.length;
      afterSeq = page[page.length - 1]!.seq;
    }
    return { valid: true, eventsChecked: checked, brokenAtSeq: null, reason: null, headHash: prevHash };
  }
}
