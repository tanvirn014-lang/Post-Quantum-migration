import { GENESIS_HASH, verifyEvents, type AuditEvent, type ChainVerification, type NewAuditEvent } from "../audit/chain.js";
import type { AuditListOptions, AuditStore } from "../ports/audit-store.js";

const VERIFY_PAGE_SIZE = 500;

/**
 * Records security-relevant events into the tamper-evident, hash-chained audit log.
 *
 * Failure semantics: record() propagates store errors, so authentication and configuration
 * events fail closed (a login that cannot be audited does not succeed). Financial postings are
 * audited INSIDE the posting's transaction (LedgerStore.postTransaction takes an audit builder),
 * so a committed posting always has its audit entry and a failed audit rolls the posting back -
 * there is no at-least-once gap for money movements. record() remains for events not tied to a
 * posting. Truncating the newest events is still only detectable against an external head hash.
 */
export class AuditService {
  constructor(
    private readonly store: AuditStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  record(event: NewAuditEvent): Promise<AuditEvent> {
    return this.store.append(event, this.clock());
  }

  list(opts: AuditListOptions): Promise<AuditEvent[]> {
    return this.store.list(opts);
  }

  /** Recomputes the whole chain. Detects edits and mid-chain deletions; truncation of the
   *  newest events is only detectable by comparing headHash against a value recorded elsewhere. */
  async verify(): Promise<ChainVerification> {
    let afterSeq = 0;
    let prevHash = GENESIS_HASH;
    let checked = 0;
    for (;;) {
      const page = await this.store.listAscending(afterSeq, VERIFY_PAGE_SIZE);
      if (page.length === 0) break;
      const result = verifyEvents(page, prevHash);
      if (!result.ok) {
        return { valid: false, eventsChecked: checked, brokenAtSeq: result.seq, reason: result.reason, headHash: prevHash };
      }
      prevHash = result.headHash;
      checked += page.length;
      afterSeq = page[page.length - 1]!.seq;
    }
    return { valid: true, eventsChecked: checked, brokenAtSeq: null, reason: null, headHash: prevHash };
  }
}
