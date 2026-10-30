import type { Account, ApiError, Posting, Transaction } from "./types.js";

const baseUrl = process.env.NEXT_PUBLIC_LEDGER_API_URL ?? "http://localhost:3000";

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const errorBody = body as ApiError;
    throw new Error(errorBody.error.message);
  }
  return body as T;
}

export async function getAccount(accountId: string): Promise<Account> {
  const res = await fetch(`${baseUrl}/accounts/${accountId}`);
  return parseOrThrow<Account>(res);
}

export async function listPostings(accountId: string, limit?: number): Promise<Posting[]> {
  const query = limit !== undefined ? `?limit=${limit}` : "";
  const res = await fetch(`${baseUrl}/accounts/${accountId}/postings${query}`);
  return parseOrThrow<Posting[]>(res);
}

export interface PostTransferInput {
  idempotencyKey: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinorUnits: string;
  currency: string;
  description: string;
}

export async function postTransfer(input: PostTransferInput): Promise<Transaction> {
  const res = await fetch(`${baseUrl}/transfers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amountMinorUnits: input.amountMinorUnits,
      currency: input.currency,
      description: input.description,
    }),
  });
  return parseOrThrow<Transaction>(res);
}
