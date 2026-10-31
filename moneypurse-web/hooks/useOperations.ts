import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ledger, type CreateCustomerInput, type OpenAccountInput } from "../lib/api/ledger-client";

export type { Customer } from "../lib/api/types";

export function useCustomers() {
  return useQuery({ queryKey: ["operations", "customers"], queryFn: () => ledger.listCustomers() });
}

export function useAllAccounts() {
  return useQuery({ queryKey: ["operations", "accounts"], queryFn: () => ledger.listAccounts({ limit: 200 }) });
}

export function useCreateCustomer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) => ledger.createCustomer(input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operations"] }),
  });
}

export function useOpenAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenAccountInput) => ledger.openAccount(input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operations"] }),
  });
}
