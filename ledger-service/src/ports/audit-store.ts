import type { AuditEvent, NewAuditEvent } from "../audit/chain.js";

export interface AuditListOptions {
  limit: number;
  beforeSeq?: number;
  action?: string;
  actorUserId?: string;
  outcome?: AuditEvent["outcome"];
}

export interface AuditStore {
  /** Appends one event, linking it to the previous event's hash. Appends are serialized so
   *  the chain stays linear under concurrent writers. */
  append(input: NewAuditEvent, occurredAt: Date): Promise<AuditEvent>;
  /** Newest first. */
  list(opts: AuditListOptions): Promise<AuditEvent[]>;
  /** Oldest first, for chain verification. */
  listAscending(afterSeq: number, limit: number): Promise<AuditEvent[]>;
}
