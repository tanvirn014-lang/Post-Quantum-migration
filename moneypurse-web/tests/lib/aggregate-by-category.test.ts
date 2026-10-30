import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateByCategory } from "../../lib/aggregate-by-category.js";
import type { Posting } from "../../lib/api/types.js";

const posting = (amountMinorUnits: string, transactionId: string): Posting => ({
  id: "p",
  transactionId,
  accountId: "a",
  currency: "BDT",
  amountMinorUnits,
  createdAt: new Date().toISOString(),
});

test("groups expense postings by category and sums their absolute amounts", () => {
  const postings = [posting("-50000", "t1"), posting("-30000", "t2")];
  const descriptions = { t1: "Shwapno Supermarket", t2: "Agora grocery" };
  const result = aggregateByCategory(postings, descriptions);
  const groceries = result.find((r) => r.category === "Groceries")!;
  assert.strictEqual(groceries.totalMinorUnits, "80000");
  assert.strictEqual(groceries.postings.length, 2);
});

test("excludes income (positive) postings", () => {
  const postings = [posting("100000", "t1")];
  const result = aggregateByCategory(postings, { t1: "Salary" });
  assert.strictEqual(result.length, 0);
});

test("falls back to Other for an unmatched description", () => {
  const postings = [posting("-1000", "t1")];
  const result = aggregateByCategory(postings, { t1: "xyz123" });
  assert.strictEqual(result[0]!.category, "Other");
});
