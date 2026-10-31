/** Descriptive statistics used by the benchmark harness. Pure functions, unit tested. */

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
}

/** Percentile with linear interpolation between closest ranks (R type 7, the common default). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  if (p < 0 || p > 100) throw new RangeError("percentile must be within 0..100");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

export const median = (values: readonly number[]): number => percentile(values, 50);

export interface Distribution {
  n: number;
  mean: number;
  stddev: number;
  min: number;
  median: number;
  p95: number;
  p99: number;
  max: number;
}

export function describe(values: readonly number[]): Distribution {
  return {
    n: values.length,
    mean: mean(values),
    stddev: stddev(values),
    min: values.length ? Math.min(...values) : NaN,
    median: median(values),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length ? Math.max(...values) : NaN,
  };
}

/** Small deterministic PRNG so bootstrap results are reproducible from a recorded seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ConfidenceInterval {
  estimate: number;
  lower: number;
  upper: number;
  level: number;
  resamples: number;
  seed: number;
}

/**
 * Percentile bootstrap confidence interval for `statistic` over `samples`. Assumption-free, which
 * matters here: handshake timings are skewed and the number of independent runs is small. The
 * resampling unit must be an independent run, not an individual handshake.
 */
export function bootstrapCI(
  samples: readonly number[],
  statistic: (values: readonly number[]) => number,
  opts: { level?: number; resamples?: number; seed?: number } = {},
): ConfidenceInterval {
  const level = opts.level ?? 0.95;
  const resamples = opts.resamples ?? 2000;
  const seed = opts.seed ?? 20260801;
  if (samples.length === 0) return { estimate: NaN, lower: NaN, upper: NaN, level, resamples, seed };
  const rand = mulberry32(seed);
  const estimates: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const draw = Array.from({ length: samples.length }, () => samples[Math.floor(rand() * samples.length)]!);
    estimates.push(statistic(draw));
  }
  const alpha = (1 - level) / 2;
  return {
    estimate: statistic(samples),
    lower: percentile(estimates, alpha * 100),
    upper: percentile(estimates, (1 - alpha) * 100),
    level,
    resamples,
    seed,
  };
}

export type Verdict = "hybrid-slower" | "hybrid-faster" | "not-distinguishable";

/** Interprets a paired-difference interval (hybrid minus classical): does it exclude zero? */
export function verdictFromInterval(ci: ConfidenceInterval): Verdict {
  if (ci.lower > 0) return "hybrid-slower";
  if (ci.upper < 0) return "hybrid-faster";
  return "not-distinguishable";
}
