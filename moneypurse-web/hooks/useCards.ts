import { useQuery } from "@tanstack/react-query";
import { getCards } from "../lib/mock/cards";

export function useCards(customerId: string) {
  return useQuery({
    queryKey: ["cards", customerId],
    queryFn: () => getCards(customerId),
  });
}
