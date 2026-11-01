/**
 * Single-use guard for partner assertions. The sidecar stamps each assertion with a unique `jti`;
 * the core records it here and refuses a repeat, so a captured assertion cannot be replayed even
 * inside its freshness window. Entries are pruned once they are older than the window, after which
 * the assertion's own freshness check (verifyAssertion) is the only guard left anyway.
 *
 * In-memory and per-process: adequate for the single-instance prototype. A horizontally-scaled
 * deployment needs a shared store (see docs/IMPLEMENTATION_PLAN.md M7 / BKLG-13).
 */
export class AssertionReplayCache {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Records `jti`; returns true if it is new (accept) or false if it was already seen (replay). */
  checkAndRecord(jti: string): boolean {
    const now = this.now();
    this.prune(now);
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, now + this.ttlMs);
    return true;
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}
