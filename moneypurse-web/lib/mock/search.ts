export interface SearchSuggestion {
  id: string;
  label: string;
  type: "recipient" | "action";
}

const MOCK_SUGGESTIONS: SearchSuggestion[] = [
  { id: "sugg_1", label: "Send money to Rafiq", type: "recipient" },
  { id: "sugg_2", label: "Send money to Nabila", type: "recipient" },
  { id: "sugg_3", label: "Pay electricity bill", type: "action" },
  { id: "sugg_4", label: "Freeze my card", type: "action" },
  { id: "sugg_5", label: "Top up bKash", type: "recipient" },
  { id: "sugg_6", label: "View savings pots", type: "action" },
];

/** No search backend exists - this filters a static fixture list by substring match. */
export async function getSearchSuggestions(query: string): Promise<SearchSuggestion[]> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const lower = query.toLowerCase();
  return MOCK_SUGGESTIONS.filter((s) => s.label.toLowerCase().includes(lower));
}
