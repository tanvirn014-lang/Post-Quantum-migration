// KEEP IN SYNC with ledger-service/src/audit/chain.ts (tests/audit-chain-sync.test.ts enforces byte equality of the body).
import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

export type AuditOutcome = "success" | "denied" | "failure";

export interface NewAuditEvent {
  actorUserId?: string | null | undefined;
  actorRole?: string | null | undefined;
  action: string;
  resourceType?: string | null | undefined;
  resourceId?: string | null | undefined;
  outcome: AuditOutcome;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  correlationId?: string | null | undefined;
  /** Small JSON-serializable facts about the event. Never secrets, tokens or passwords. */
  details?: Record<string, unknown> | undefined;
}

export interface AuditEvent {
  seq: number;
  id: string;
  occurredAt: Date;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

/** JSON with object keys sorted recursively, so the same logical value always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

type Hashable = Pick<
  AuditEvent,
  | "id"
  | "occurredAt"
  | "actorUserId"
  | "actorRole"
  | "action"
  | "resourceType"
  | "resourceId"
  | "outcome"
  | "ip"
  | "userAgent"
  | "correlationId"
  | "details"
>;

export function computeAuditHash(prevHash: string, e: Hashable): string {
  const payload = canonicalJson({
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    actorUserId: e.actorUserId,
    actorRole: e.actorRole,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId,
    outcome: e.outcome,
    ip: e.ip,
    userAgent: e.userAgent,
    correlationId: e.correlationId,
    details: e.details,
  });
  return createHash("sha256").update(prevHash).update("\n").update(payload).digest("hex");
}

export interface ChainVerification {
  valid: boolean;
  eventsChecked: number;
  /** seq of the first event whose link or hash does not verify. */
  brokenAtSeq: number | null;
  reason: string | null;
  headHash: string;
}

/** Verifies a contiguous run of events, oldest first, starting from `expectedPrevHash`. */
export function verifyEvents(
  events: readonly AuditEvent[],
  expectedPrevHash: string,
): { ok: true; headHash: string } | { ok: false; seq: number; reason: string } {
  let prev = expectedPrevHash;
  for (const event of events) {
    if (event.prevHash !== prev) {
      return { ok: false, seq: event.seq, reason: "previous-hash link does not match" };
    }
    if (computeAuditHash(prev, event) !== event.hash) {
      return { ok: false, seq: event.seq, reason: "event contents do not match their hash" };
    }
    prev = event.hash;
  }
  return { ok: true, headHash: prev };
}
