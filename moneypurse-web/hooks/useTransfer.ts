import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postTransfer, type PostTransferInput } from "../lib/api/ledger-client";

/** Posts a customer transfer, then refreshes balances and activity. The caller supplies the
 *  idempotency key and keeps it until the transfer succeeds, so retrying after a network
 *  failure replays the same transfer instead of moving the money twice. */
export function useTransfer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PostTransferInput) => postTransfer(input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["accounts"] }),
        client.invalidateQueries({ queryKey: ["postings"] }),
        client.invalidateQueries({ queryKey: ["account"] }),
      ]);
    },
  });
}
