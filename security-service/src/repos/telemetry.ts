import type pg from "pg";
import type { Queryable } from "../db/pool.js";
import type { Decision, KeyExchange, PeerProfile, Severity } from "../domain/policy.js";
import { severityFor } from "../domain/policy.js";

export interface OfferedGroup {
  code: number;
  name?: string | undefined;
}

export interface ConnectionEventInput {
  id: string;
  correlationId: string;
  occurredAt: Date;
  remoteAddr?: string | undefined;
  peerId?: string | undefined;
  peerName?: string | undefined;
  certSha256?: string | undefined;
  expectedProfile?: PeerProfile | undefined;
  tlsVersion?: string | undefined;
  cipher?: string | undefined;
  offeredGroups: OfferedGroup[];
  negotiatedGroup?: string | undefined;
  negotiatedGroupCode?: number | undefined;
  keyExchange: KeyExchange;
  clientKeyShareBytes?: number | undefined;
  serverKeyShareBytes?: number | undefined;
  decision: Decision;
  reason: string;
  handshakeMs?: number | undefined;
  configVersion: number;
  requestsForwarded?: number | undefined;
}

export interface ConnectionEvent {
  id: string;
  correlationId: string;
  occurredAt: Date;
  remoteAddr: string | null;
  peerId: string | null;
  peerName: string | null;
  certSha256: string | null;
  expectedProfile: PeerProfile | null;
  tlsVersion: string | null;
  cipher: string | null;
  offeredGroups: OfferedGroup[];
  negotiatedGroup: string | null;
  negotiatedGroupCode: number | null;
  keyExchange: KeyExchange;
  clientKeyShareBytes: number | null;
  serverKeyShareBytes: number | null;
  decision: Decision;
  severity: Severity;
  reason: string;
  handshakeMs: number | null;
  configVersion: number;
  requestsForwarded: number;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  ackNote: string | null;
}

interface EventRow {
  id: string;
  correlation_id: string;
  occurred_at: Date;
  remote_addr: string | null;
  peer_id: string | null;
  peer_name: string | null;
  cert_sha256: string | null;
  expected_profile: PeerProfile | null;
  tls_version: string | null;
  cipher: string | null;
  offered_groups: OfferedGroup[];
  negotiated_group: string | null;
  negotiated_group_code: number | null;
  key_exchange: KeyExchange;
  client_key_share_bytes: number | null;
  server_key_share_bytes: number | null;
  decision: Decision;
  severity: Severity;
  reason: string;
  handshake_ms: string | null;
  config_version: string;
  requests_forwarded: number;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  ack_note: string | null;
}

const mapEvent = (r: EventRow): ConnectionEvent => ({
  id: r.id,
  correlationId: r.correlation_id,
  occurredAt: r.occurred_at,
  remoteAddr: r.remote_addr,
  peerId: r.peer_id,
  peerName: r.peer_name,
  certSha256: r.cert_sha256,
  expectedProfile: r.expected_profile,
  tlsVersion: r.tls_version,
  cipher: r.cipher,
  offeredGroups: r.offered_groups,
  negotiatedGroup: r.negotiated_group,
  negotiatedGroupCode: r.negotiated_group_code,
  keyExchange: r.key_exchange,
  clientKeyShareBytes: r.client_key_share_bytes,
  serverKeyShareBytes: r.server_key_share_bytes,
  decision: r.decision,
  severity: r.severity,
  reason: r.reason,
  handshakeMs: r.handshake_ms === null ? null : Number(r.handshake_ms),
  configVersion: Number(r.config_version),
  requestsForwarded: r.requests_forwarded,
  acknowledgedAt: r.acknowledged_at,
  acknowledgedBy: r.acknowledged_by,
  ackNote: r.ack_note,
});

export interface ConnectionFilter {
  limit: number;
  /** Cursor: only events strictly older than this instant. */
  before?: Date | undefined;
  decision?: Decision | undefined;
  keyExchange?: KeyExchange | undefined;
  peerId?: string | undefined;
  alertsOnly?: boolean | undefined;
  unacknowledgedOnly?: boolean | undefined;
}

export interface TelemetrySummary {
  sinceHours: number;
  total: number;
  byDecision: Record<string, number>;
  byKeyExchange: Record<string, number>;
  openAlerts: number;
  handshakeMs: Record<string, { count: number; mean: number; p50: number; p95: number; p99: number }>;
}

export class TelemetryRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** Idempotent on event id, so a sidecar retrying a batch never duplicates events. */
  async insertConnections(events: ConnectionEventInput[]): Promise<number> {
    if (events.length === 0) return 0;
    let inserted = 0;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const e of events) {
        const result = await client.query(
          `INSERT INTO connection_events
             (id, correlation_id, occurred_at, remote_addr, peer_id, peer_name, cert_sha256, expected_profile,
              tls_version, cipher, offered_groups, negotiated_group, negotiated_group_code, key_exchange,
              client_key_share_bytes, server_key_share_bytes, decision, severity, reason, handshake_ms,
              config_version, requests_forwarded)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           ON CONFLICT (id) DO NOTHING`,
          [
            e.id,
            e.correlationId,
            e.occurredAt,
            e.remoteAddr ?? null,
            e.peerId ?? null,
            e.peerName ?? null,
            e.certSha256 ?? null,
            e.expectedProfile ?? null,
            e.tlsVersion ?? null,
            e.cipher ?? null,
            JSON.stringify(e.offeredGroups),
            e.negotiatedGroup ?? null,
            e.negotiatedGroupCode ?? null,
            e.keyExchange,
            e.clientKeyShareBytes ?? null,
            e.serverKeyShareBytes ?? null,
            e.decision,
            severityFor(e.decision),
            e.reason,
            e.handshakeMs ?? null,
            e.configVersion,
            e.requestsForwarded ?? 0,
          ],
        );
        inserted += result.rowCount ?? 0;
      }
      await client.query("COMMIT");
      return inserted;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async list(filter: ConnectionFilter): Promise<ConnectionEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT * FROM connection_events
       WHERE ($1::timestamptz IS NULL OR occurred_at < $1)
         AND ($2::text IS NULL OR decision = $2)
         AND ($3::text IS NULL OR key_exchange = $3)
         AND ($4::uuid IS NULL OR peer_id = $4)
         AND (NOT $5::boolean OR severity IN ('medium','high','critical'))
         AND (NOT $6::boolean OR acknowledged_at IS NULL)
       ORDER BY occurred_at DESC, id
       LIMIT $7`,
      [
        filter.before ?? null,
        filter.decision ?? null,
        filter.keyExchange ?? null,
        filter.peerId ?? null,
        filter.alertsOnly ?? false,
        filter.unacknowledgedOnly ?? false,
        filter.limit,
      ],
    );
    return rows.map(mapEvent);
  }

  async get(id: string): Promise<ConnectionEvent | null> {
    const { rows } = await this.pool.query<EventRow>("SELECT * FROM connection_events WHERE id = $1", [id]);
    return rows[0] ? mapEvent(rows[0]) : null;
  }

  /** Returns the updated event, or null if it does not exist or is not an alert. */
  async acknowledge(db: Queryable, id: string, userId: string, note: string | null): Promise<ConnectionEvent | null> {
    const { rows } = await db.query<EventRow>(
      `UPDATE connection_events
       SET acknowledged_at = COALESCE(acknowledged_at, now()), acknowledged_by = COALESCE(acknowledged_by, $2), ack_note = COALESCE(ack_note, $3)
       WHERE id = $1 AND severity IN ('medium','high','critical')
       RETURNING *`,
      [id, userId, note],
    );
    return rows[0] ? mapEvent(rows[0]) : null;
  }

  async summary(sinceHours: number): Promise<TelemetrySummary> {
    const since = new Date(Date.now() - sinceHours * 3_600_000);
    const [{ rows: byDecision }, { rows: byKex }, { rows: timing }, { rows: open }] = await Promise.all([
      this.pool.query<{ decision: string; n: number }>(
        "SELECT decision, count(*)::int AS n FROM connection_events WHERE occurred_at >= $1 GROUP BY decision",
        [since],
      ),
      this.pool.query<{ key_exchange: string; n: number }>(
        "SELECT key_exchange, count(*)::int AS n FROM connection_events WHERE occurred_at >= $1 GROUP BY key_exchange",
        [since],
      ),
      this.pool.query<{ key_exchange: string; n: number; mean: string; p50: string; p95: string; p99: string }>(
        `SELECT key_exchange, count(*)::int AS n, avg(handshake_ms) AS mean,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY handshake_ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY handshake_ms) AS p95,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY handshake_ms) AS p99
         FROM connection_events WHERE occurred_at >= $1 AND handshake_ms IS NOT NULL GROUP BY key_exchange`,
        [since],
      ),
      this.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM connection_events WHERE severity IN ('medium','high','critical') AND acknowledged_at IS NULL",
      ),
    ]);
    const decisions = Object.fromEntries(byDecision.map((r) => [r.decision, r.n]));
    return {
      sinceHours,
      total: byDecision.reduce((sum, r) => sum + r.n, 0),
      byDecision: decisions,
      byKeyExchange: Object.fromEntries(byKex.map((r) => [r.key_exchange, r.n])),
      openAlerts: open[0]?.n ?? 0,
      handshakeMs: Object.fromEntries(
        timing.map((r) => [r.key_exchange, { count: r.n, mean: Number(r.mean), p50: Number(r.p50), p95: Number(r.p95), p99: Number(r.p99) }]),
      ),
    };
  }
}
