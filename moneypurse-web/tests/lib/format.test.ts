import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatRelativeDate } from "../../lib/format.js";

test("formatCurrency renders BDT minor units as a taka amount with the symbol", () => {
  assert.strictEqual(formatCurrency("523000", "BDT"), "৳5,230.00");
});

test("formatCurrency handles zero", () => {
  assert.strictEqual(formatCurrency("0", "BDT"), "৳0.00");
});

test("formatCurrency handles a negative amount", () => {
  assert.strictEqual(formatCurrency("-150000", "BDT"), "-৳1,500.00");
});

test("formatRelativeDate renders a timestamp under a day old as hours ago", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const twoHoursAgo = new Date("2026-10-30T10:00:00Z").toISOString();
  assert.strictEqual(formatRelativeDate(twoHoursAgo, now), "2 hours ago");
});

test("formatRelativeDate renders a timestamp over 7 days old as a calendar date", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const old = new Date("2026-01-05T12:00:00Z").toISOString();
  assert.strictEqual(formatRelativeDate(old, now), "Jan 5, 2026");
});
