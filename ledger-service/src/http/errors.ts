import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { DomainError } from "../domain/errors.js";

const STATUS_BY_CODE: Record<string, number> = {
  ACCOUNT_NOT_FOUND: 404,
  TRANSACTION_NOT_FOUND: 404,
  INSUFFICIENT_FUNDS: 409,
  ACCOUNT_CLOSED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  UNBALANCED_TRANSACTION: 400,
  SINGLE_POSTING_TRANSACTION: 400,
  CURRENCY_MISMATCH: 400,
  MISSING_IDEMPOTENCY_KEY: 400,
};

/** Maps a thrown error to an HTTP response. Never leaks internals for unrecognized errors. */
export function sendError(reply: FastifyReply, err: unknown): void {
  if (err instanceof DomainError) {
    const status = STATUS_BY_CODE[err.code] ?? 400;
    reply.status(status).send({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request failed validation",
        details: err.issues,
      },
    });
    return;
  }
  reply.log.error(err);
  reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
}
