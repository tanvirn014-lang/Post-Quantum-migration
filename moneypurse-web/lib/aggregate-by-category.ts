import type { Posting } from "./api/types";
import { categorize } from "./categorize";

export interface CategorySpend {
  category: string;
  totalMinorUnits: string;
  postings: Posting[];
}

/**
 * Groups expense (negative) postings by a mock category guess (see lib/categorize.ts)
 * derived from the owning transaction's description. Income postings are excluded - this is
 * a spending breakdown, not a cash-flow view (see CashFlowChart for that).
 */
export function aggregateByCategory(postings: Posting[], descriptionsByTransactionId: Record<string, string>): CategorySpend[] {
  const groups = new Map<string, { total: bigint; postings: Posting[] }>();

  for (const posting of postings) {
    const amount = BigInt(posting.amountMinorUnits);
    if (amount >= 0n) continue;

    const description = descriptionsByTransactionId[posting.transactionId] ?? "";
    const category = categorize(description);
    const group = groups.get(category) ?? { total: 0n, postings: [] };
    group.total += -amount;
    group.postings.push(posting);
    groups.set(category, group);
  }

  return Array.from(groups.entries()).map(([category, group]) => ({
    category,
    totalMinorUnits: group.total.toString(),
    postings: group.postings,
  }));
}
