import { randomUUID } from "node:crypto";
import { GENESIS_HASH, computeAuditHash, type AuditEvent, type NewAuditEvent } from "../../audit/chain.js";
import type { AuditListOptions, AuditStore } from "../../ports/audit-store.js";

export class MemoryAuditStore implements AuditStore {
  private events: AuditEvent[] = [];

  async append(input: NewAuditEvent, occurredAt: Date): Promise<AuditEvent> {
    const prev = this.events[this.events.length - 1];
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
    const prevHash = prev?.hash ?? GENESIS_HASH;
    const event: AuditEvent = { seq: (prev?.seq ?? 0) + 1, ...partial, prevHash, hash: computeAuditHash(prevHash, partial) };
    this.events.push(event);
    return { ...event };
  }

  async list(opts: AuditListOptions): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => (opts.beforeSeq === undefined || e.seq < opts.beforeSeq))
      .filter((e) => (opts.action === undefined || e.action === opts.action))
      .filter((e) => (opts.actorUserId === undefined || e.actorUserId === opts.actorUserId))
      .filter((e) => (opts.outcome === undefined || e.outcome === opts.outcome))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, opts.limit)
      .map((e) => ({ ...e }));
  }

  async listAscending(afterSeq: number, limit: number): Promise<AuditEvent[]> {
    return this.events.filter((e) => e.seq > afterSeq).slice(0, limit).map((e) => ({ ...e }));
  }

  /** Test hook: simulates direct database tampering that bypasses the append-only API. */
  tamperForTest(seq: number, mutate: (e: AuditEvent) => void): void {
    const e = this.events.find((x) => x.seq === seq);
    if (e) mutate(e);
  }
}
