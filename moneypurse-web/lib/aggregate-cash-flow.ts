import type { Posting } from "./api/types";

export type CashFlowPeriod = "week" | "month" | "year";

export interface CashFlowBucket {
  label: string;
  income: number;
  expense: number;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short" });

interface PeriodConfig {
  bucketCount: number;
  bucketSpanMs: number;
  labelFor(bucketsAgo: number, now: Date): string;
}

const PERIOD_CONFIG: Record<CashFlowPeriod, PeriodConfig> = {
  week: {
    bucketCount: 7,
    bucketSpanMs: DAY_MS,
    labelFor: (bucketsAgo, now) =>
      bucketsAgo === 0 ? "Today" : WEEKDAY_FORMATTER.format(new Date(now.getTime() - bucketsAgo * DAY_MS)),
  },
  month: {
    // ~30 days bucketed by week, per the design spec's "month: last 30 days by week".
    bucketCount: 5,
    bucketSpanMs: WEEK_MS,
    labelFor: (bucketsAgo) => (bucketsAgo === 0 ? "This wk" : `${bucketsAgo}wk ago`),
  },
  year: {
    bucketCount: 12,
    bucketSpanMs: MONTH_MS,
    labelFor: (bucketsAgo, now) => MONTH_FORMATTER.format(new Date(now.getTime() - bucketsAgo * MONTH_MS)),
  },
};

/**
 * Buckets postings into a fixed number of rolling periods ending "now", converting minor
 * units to major-units numbers for charting only (never sent back to an API - see the plan's
 * Task 14 interface note on why this is the one place that conversion is intentional).
 * A posting with an unparseable createdAt or amountMinorUnits is skipped, not thrown - this
 * is chart display code, and one malformed posting must not take the whole widget down.
 */
export function aggregateCashFlow(postings: Posting[], period: CashFlowPeriod, now: Date = new Date()): CashFlowBucket[] {
  const { bucketCount, bucketSpanMs, labelFor } = PERIOD_CONFIG[period];

  const buckets: CashFlowBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    label: labelFor(bucketCount - 1 - i, now),
    income: 0,
    expense: 0,
  }));

  for (const posting of postings) {
    const createdAtMs = new Date(posting.createdAt).getTime();
    if (Number.isNaN(createdAtMs)) continue;

    const ageMs = now.getTime() - createdAtMs;
    if (ageMs < 0) continue;
    const bucketIndexFromEnd = Math.floor(ageMs / bucketSpanMs);
    if (bucketIndexFromEnd >= bucketCount) continue;

    let amountMinorUnits: bigint;
    try {
      amountMinorUnits = BigInt(posting.amountMinorUnits);
    } catch {
      continue;
    }

    const bucket = buckets[bucketCount - 1 - bucketIndexFromEnd]!;
    const amount = Number(amountMinorUnits) / 100;
    if (amount >= 0) {
      bucket.income += amount;
    } else {
      bucket.expense += -amount;
    }
  }

  return buckets;
}
