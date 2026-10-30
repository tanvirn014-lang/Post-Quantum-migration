import { useQuery } from "@tanstack/react-query";
import { getAlerts } from "../lib/mock/alerts";

export function useAlerts(customerId: string) {
  return useQuery({
    queryKey: ["alerts", customerId],
    queryFn: () => getAlerts(customerId),
  });
}
