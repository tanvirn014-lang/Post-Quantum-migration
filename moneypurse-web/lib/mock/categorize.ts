/**
 * A deterministic keyword-match category guess for a transaction description.
 * ledger-service has no category field at all - this is a presentation-layer guess
 * layered on top of real posting descriptions, not a real backend feature. See the
 * design spec's data-layer table.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Groceries: ["grocery", "groceries", "supermarket", "shwapno", "agora", "meena bazar"],
  Transfer: ["bkash", "nagad", "rocket", "transfer", "send money", "upay"],
  Housing: ["rent", "housing", "landlord"],
  Utilities: ["electricity", "gas bill", "water bill", "internet", "wifi"],
  Dining: ["restaurant", "cafe", "food panda", "foodpanda", "coffee"],
  Transport: ["uber", "pathao", "cng", "fuel", "petrol"],
};

export function categorize(description: string): string {
  const lower = description.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return category;
    }
  }
  return "Other";
}
