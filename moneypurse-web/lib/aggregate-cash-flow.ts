import type { Posting } from "./api/types";

export type CashFlowPeriod = "week" | "month" | "year";

export interface CashFlowBucket {
  label: string;
  income: number;
  expense: number;
}

const DAY_MS = 86_400_000;

/**
 * Buckets postings into a fixed number of calendar periods ending "now", converting minor
 * units to major-units numbers for charting only (never sent back to an API - see the plan's
 * Task 14 interface note on why this is the one place that conversion is intentional).
 */
export function aggregateCashFlow(postings: Posting[], period: CashFlowPeriod, now: Date = new Date()): CashFlowBucket[] {
  const bucketCount = period === "week" ? 7 : period === "month" ? 30 : 12;
  const bucketSpanMs = period === "year" ? 30 * DAY_MS : DAY_MS;

  const buckets: CashFlowBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    label: String(bucketCount - 1 - i),
    income: 0,
    expense: 0,
  }));

  for (const posting of postings) {
    const ageMs = now.getTime() - new Date(posting.createdAt).getTime();
    if (ageMs < 0) continue;
    const bucketIndexFromEnd = Math.floor(ageMs / bucketSpanMs);
    if (bucketIndexFromEnd >= bucketCount) continue;

    const bucket = buckets[bucketCount - 1 - bucketIndexFromEnd]!;
    const amount = Number(BigInt(posting.amountMinorUnits)) / 100;
    if (amount >= 0) {
      bucket.income += amount;
    } else {
      bucket.expense += -amount;
    }
  }

  return buckets;
}
