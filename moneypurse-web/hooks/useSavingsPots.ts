import { useQuery } from "@tanstack/react-query";
import { getSavingsPots } from "../lib/mock/pots.js";

export function useSavingsPots(customerId: string) {
  return useQuery({
    queryKey: ["savingsPots", customerId],
    queryFn: () => getSavingsPots(customerId),
  });
}
