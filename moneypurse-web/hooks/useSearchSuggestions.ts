import { useQuery } from "@tanstack/react-query";
import { getSearchSuggestions } from "../lib/mock/search";

export function useSearchSuggestions(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => getSearchSuggestions(query),
    enabled: query.length > 0,
  });
}
