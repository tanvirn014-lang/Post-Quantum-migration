import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateCashFlow } from "../../lib/aggregate-cash-flow.js";
import type { Posting } from "../../lib/api/types.js";

const posting = (amountMinorUnits: string, daysAgo: number, now: Date): Posting => ({
  id: "p",
  transactionId: "t",
  accountId: "a",
  currency: "BDT",
  amountMinorUnits,
  createdAt: new Date(now.getTime() - daysAgo * 86400000).toISOString(),
});

test("buckets a week's postings by day, separating income and expense", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const postings = [posting("100000", 1, now), posting("-50000", 1, now)];
  const result = aggregateCashFlow(postings, "week", now);
  const day = result.find((r) => r.income > 0 || r.expense > 0)!;
  assert.strictEqual(day.income, 1000);
  assert.strictEqual(day.expense, 500);
});

test("excludes postings older than the requested period", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const postings = [posting("100000", 400, now)];
  const result = aggregateCashFlow(postings, "week", now);
  assert.strictEqual(
    result.every((r) => r.income === 0),
    true,
  );
});

test("returns one bucket per day for the week period", () => {
  const result = aggregateCashFlow([], "week", new Date("2026-10-30T00:00:00Z"));
  assert.strictEqual(result.length, 7);
});

test("skips a posting with an invalid createdAt instead of throwing", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const badPosting: Posting = { ...posting("100000", 1, now), createdAt: "not-a-date" };
  assert.doesNotThrow(() => aggregateCashFlow([badPosting], "week", now));
  const result = aggregateCashFlow([badPosting], "week", now);
  assert.strictEqual(
    result.every((r) => r.income === 0 && r.expense === 0),
    true,
  );
});

test("skips a posting with a non-numeric amountMinorUnits instead of throwing", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const badPosting: Posting = { ...posting("not-a-number", 1, now) };
  assert.doesNotThrow(() => aggregateCashFlow([badPosting], "week", now));
});

test("week bucket labels are weekday names, not bare integers", () => {
  const result = aggregateCashFlow([], "week", new Date("2026-10-30T00:00:00Z"));
  assert.strictEqual(result[result.length - 1]!.label, "Today");
  assert.notStrictEqual(result[0]!.label, "6");
});
