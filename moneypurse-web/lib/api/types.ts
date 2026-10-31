// Mirrors ledger-service's DTOs field-for-field (see ledger-service/src/http/dto.ts and routes).
// Money crosses the wire as a decimal string in minor units, never a number - see the project's
// Global Constraints.

export type AccountKind = "current" | "savings" | "settlement";

export interface Account {
  id: string;
  ownerCustomerId: string;
  currency: string;
  kind: AccountKind;
  status: "active" | "frozen" | "closed";
  balanceMinorUnits: string;
  allowOverdraft: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  idempotencyKey: string;
  description: string;
  status: "posted" | "reversed";
  postedAt: string;
  metadata: Record<string, unknown>;
}

export interface Posting {
  id: string;
  transactionId: string;
  accountId: string;
  amountMinorUnits: string;
  currency: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
}

export interface AuditEventDTO {
  seq: number;
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: "success" | "denied" | "failure";
  ip: string | null;
  correlationId: string | null;
  details: Record<string, unknown>;
  hash: string;
}

export interface AuditPage {
  events: AuditEventDTO[];
  nextBeforeSeq: number | null;
}

export interface ChainVerification {
  valid: boolean;
  eventsChecked: number;
  brokenAtSeq: number | null;
  reason: string | null;
  headHash: string;
}
