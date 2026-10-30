import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { LedgerService } from "../../app/ledger-service.js";
import { MissingIdempotencyKeyError, TransactionNotFoundError } from "../../domain/errors.js";
import { toPostingDTO, toTransactionDTO } from "../dto.js";
import { sendError } from "../errors.js";
import { accountId, currencyCode, minorUnitsString } from "../schemas.js";

const postingSchema = z.object({
  accountId,
  amountMinorUnits: minorUnitsString,
  currency: currencyCode,
});

const postTransactionSchema = z.object({
  description: z.string().min(1).max(500),
  postings: z.array(postingSchema).min(2),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const transferSchema = z.object({
  fromAccountId: accountId,
  toAccountId: accountId,
  amountMinorUnits: minorUnitsString,
  currency: currencyCode,
  description: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function requireIdempotencyKey(req: { headers: Record<string, unknown> }): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length === 0) {
    throw new MissingIdempotencyKeyError();
  }
  return key;
}

export function registerTransactionRoutes(service: LedgerService): FastifyPluginAsync {
  return async (app) => {
    app.post("/transactions", async (req, reply) => {
      try {
        const idempotencyKey = requireIdempotencyKey(req);
        const body = postTransactionSchema.parse(req.body);
        const transaction = await service.postTransaction({
          idempotencyKey,
          description: body.description,
          postings: body.postings.map((p) => ({
            accountId: p.accountId,
            amountMinorUnits: BigInt(p.amountMinorUnits),
            currency: p.currency,
          })),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        });
        reply.status(201).send(toTransactionDTO(transaction));
      } catch (err) {
        sendError(reply, err);
      }
    });

    app.post("/transfers", async (req, reply) => {
      try {
        const idempotencyKey = requireIdempotencyKey(req);
        const body = transferSchema.parse(req.body);
        const transaction = await service.transfer({
          idempotencyKey,
          fromAccountId: body.fromAccountId,
          toAccountId: body.toAccountId,
          amountMinorUnits: BigInt(body.amountMinorUnits),
          currency: body.currency,
          description: body.description,
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        });
        reply.status(201).send(toTransactionDTO(transaction));
      } catch (err) {
        sendError(reply, err);
      }
    });

    app.get<{ Params: { id: string } }>("/transactions/:id", async (req, reply) => {
      try {
        const result = await service.getTransaction(req.params.id);
        if (!result) throw new TransactionNotFoundError(req.params.id);
        reply.send({
          transaction: toTransactionDTO(result.transaction),
          postings: result.postings.map(toPostingDTO),
        });
      } catch (err) {
        sendError(reply, err);
      }
    });
  };
}
