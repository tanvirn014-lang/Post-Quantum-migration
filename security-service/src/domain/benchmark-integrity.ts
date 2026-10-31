/**
 * Integrity of an ingested benchmark run, derived from the run's own failure counts.
 *
 * A run with failed handshakes is a harness or environment fault, not a measurement (the harness
 * applies the same rule before publishing, pqc-sidecar `assessValidity`). Evidence rows are
 * immutable, so a run that was ingested before that rule existed is flagged here rather than edited.
 */

/** Keep equal to MAX_FAILURE_RATE in pqc-sidecar/src/bench/harness.ts. */
export const MAX_FAILURE_RATE = 0.005;

export type IntegrityStatus = "valid" | "invalid" | "unverifiable";

export interface BenchmarkIntegrity {
  status: IntegrityStatus;
  problems: string[];
}

interface ConditionCounts {
  attempted?: unknown;
  failed?: unknown;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function assessBenchmarkIntegrity(summary: Record<string, unknown>): BenchmarkIntegrity {
  const latency = (summary["latency"] ?? {}) as Record<string, ConditionCounts | undefined>;
  const throughput = Array.isArray(summary["throughput"]) ? (summary["throughput"] as { concurrency?: unknown; condition?: unknown; failures?: unknown }[]) : [];
  const problems: string[] = [];
  let checked = 0;

  for (const condition of ["classical", "hybrid"] as const) {
    const c = latency[condition];
    if (!c || !isCount(c.attempted) || !isCount(c.failed) || c.attempted === 0) continue;
    checked += 1;
    if (c.failed / c.attempted > MAX_FAILURE_RATE) {
      problems.push(`${condition}: ${c.failed} of ${c.attempted} handshakes failed (limit ${MAX_FAILURE_RATE * 100}%)`);
    }
  }
  for (const row of throughput) {
    if (!isCount(row.failures)) continue;
    checked += 1;
    if (row.failures > 0) problems.push(`throughput concurrency ${String(row.concurrency)} ${String(row.condition)}: ${row.failures} failures`);
  }

  if (problems.length > 0) return { status: "invalid", problems };
  return checked > 0 ? { status: "valid", problems: [] } : { status: "unverifiable", problems: ["The run carries no failure counts to check."] };
}
