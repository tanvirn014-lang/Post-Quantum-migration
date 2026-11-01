import type { BenchLatencySummary, BenchVerdict, BenchmarkIntegrity, ConfidenceInterval, Distribution } from "./api/security-types";
import type { Tone } from "./security-format";

/** Fixed-point number, "-" for a missing or non-finite value (the API sends null for NaN). */
export function formatNumber(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "-" : n.toFixed(digits);
}

export function formatMillis(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "-" : `${n.toFixed(digits)} ms`;
}

export interface IntegrityView {
  label: string;
  tone: Tone;
  /** Present for anything that is not a clean run: it must be shown above the run's numbers. */
  banner: string | null;
}

/** How a run's integrity is worded. An invalid run is never presented as a measurement. */
export function integrityView(integrity: BenchmarkIntegrity): IntegrityView {
  switch (integrity.status) {
    case "valid":
      return { label: "Valid", tone: "success", banner: null };
    case "invalid":
      return {
        label: "INVALID",
        tone: "danger",
        banner: `This run is not evidence. Handshakes failed during it (${integrity.problems.join("; ")}), so its statistics are not representative and must not be quoted.`,
      };
    default:
      return {
        label: "Unverifiable",
        tone: "warning",
        banner: "This run carries no failure counts, so its integrity could not be checked. Treat its numbers as unverified.",
      };
  }
}

export const VERDICT_LABEL: Record<BenchVerdict, string> = {
  "hybrid-slower": "Hybrid slower",
  "hybrid-faster": "Hybrid faster",
  "not-distinguishable": "Not distinguishable",
};

/** One sentence on what the paired-difference interval says, for the H2 card. */
export function verdictExplanation(verdict: BenchVerdict, ci: ConfidenceInterval): string {
  const level = Math.round(ci.level * 100);
  const interval = `${level}% bootstrap interval ${formatNumber(ci.lower, 3)} to ${formatNumber(ci.upper, 3)} ms, resampled over independent runs`;
  switch (verdict) {
    case "hybrid-slower":
      return `The ${interval}, lies entirely above zero: on this host the hybrid handshake was measurably slower than the classical one, by the amount shown.`;
    case "hybrid-faster":
      return `The ${interval}, lies entirely below zero: on this host the hybrid handshake was measurably faster than the classical one.`;
    default:
      return `The ${interval}, includes zero: this run cannot tell the two apart, which is not evidence that they are equal.`;
  }
}

export interface LatencyRow {
  label: string;
  classical: string;
  hybrid: string;
}

const dist = (pick: (d: Distribution) => number | null) => (s: BenchLatencySummary["classical"]) => formatMillis(pick(s.latencyMs));

/** The per-condition latency table: median, p95, p99, mean, standard deviation, plus failure counts. */
export function latencyRows(l: BenchLatencySummary): LatencyRow[] {
  const row = (label: string, f: (s: BenchLatencySummary["classical"]) => string): LatencyRow => ({ label, classical: f(l.classical), hybrid: f(l.hybrid) });
  return [
    row("Median", dist((d) => d.median)),
    row("p95", dist((d) => d.p95)),
    row("p99", dist((d) => d.p99)),
    row("Mean", dist((d) => d.mean)),
    row("Std deviation", dist((d) => d.stddev)),
    row("Handshakes ok / failed", (s) => `${s.succeeded.toLocaleString("en-US")} / ${s.failed.toLocaleString("en-US")}`),
  ];
}

export const BENCHMARK_SCOPE_NOTE =
  "Single host over loopback, client and server on the same machine. These numbers characterise this implementation in this environment only: they are not production or partner-network latency and support no capacity claim.";
