import type pg from "pg";
import type { AuditEvent, NewAuditEvent } from "../../audit/chain.js";
import type { AuditListOptions, AuditStore } from "../../ports/audit-store.js";
import { appendAuditEventInTx, mapAuditRow, type AuditRow } from "./audit-append.js";

export class PostgresAuditStore implements AuditStore {
  constructor(private readonly pool: pg.Pool) {}

  async append(input: NewAuditEvent, occurredAt: Date): Promise<AuditEvent> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const event = await appendAuditEventInTx(client, input, occurredAt);
      await client.query("COMMIT");
      return event;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async list(opts: AuditListOptions): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_events
       WHERE ($1::bigint IS NULL OR seq < $1)
         AND ($2::text IS NULL OR action = $2)
         AND ($3::uuid IS NULL OR actor_user_id = $3)
         AND ($4::text IS NULL OR outcome = $4)
       ORDER BY seq DESC LIMIT $5`,
      [opts.beforeSeq ?? null, opts.action ?? null, opts.actorUserId ?? null, opts.outcome ?? null, opts.limit],
    );
    return rows.map(mapAuditRow);
  }

  async listAscending(afterSeq: number, limit: number): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<AuditRow>(
      "SELECT * FROM audit_events WHERE seq > $1 ORDER BY seq ASC LIMIT $2",
      [afterSeq, limit],
    );
    return rows.map(mapAuditRow);
  }
}
