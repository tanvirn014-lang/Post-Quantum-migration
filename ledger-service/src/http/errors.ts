import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { DomainError } from "../domain/errors.js";
import { WeakPasswordError } from "../identity/errors.js";

const STATUS_BY_CODE: Record<string, number> = {
  ACCOUNT_NOT_FOUND: 404,
  TRANSACTION_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  INSUFFICIENT_FUNDS: 409,
  ACCOUNT_CLOSED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  EMAIL_ALREADY_REGISTERED: 409,
  UNBALANCED_TRANSACTION: 400,
  SINGLE_POSTING_TRANSACTION: 400,
  CURRENCY_MISMATCH: 400,
  MISSING_IDEMPOTENCY_KEY: 400,
  WEAK_PASSWORD: 400,
  CURRENT_PASSWORD_INCORRECT: 400,
  SAME_ACCOUNT_TRANSFER: 400,
  INVALID_CREDENTIALS: 401,
  AUTH_REQUIRED: 401,
  INVALID_TOKEN: 401,
  INVALID_REFRESH_TOKEN: 401,
  PARTNER_ASSERTION_INVALID: 401,
  FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  ORIGIN_NOT_ALLOWED: 403,
};

function body(code: string, message: string, requestId: string, details?: unknown) {
  return { error: { code, message, requestId, ...(details !== undefined ? { details } : {}) } };
}

/**
 * The one place a thrown error becomes an HTTP response, so every failure - domain rule,
 * validation, rate limit, malformed body, bug - has the same envelope and carries the request
 * id for log correlation. Unrecognized errors are logged in full and returned as a generic 500.
 */
export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof DomainError) {
    const status = STATUS_BY_CODE[err.code] ?? 400;
    const details = err instanceof WeakPasswordError ? { problems: err.problems } : undefined;
    void reply.status(status).send(body(err.code, err.message, req.id, details));
    return;
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    void reply.status(400).send(body("VALIDATION_ERROR", "Request failed validation", req.id, details));
    return;
  }
  const statusCode = (err as FastifyError).statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    const code =
      statusCode === 429 ? "RATE_LIMITED" : statusCode === 413 ? "PAYLOAD_TOO_LARGE" : statusCode === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "BAD_REQUEST";
    void reply.status(statusCode).send(body(code, statusCode === 429 ? "Too many requests, slow down" : err.message, req.id));
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.status(500).send(body("INTERNAL_ERROR", "Something went wrong", req.id));
}

export function notFoundHandler(req: FastifyRequest, reply: FastifyReply): void {
  void reply.status(404).send(body("NOT_FOUND", "Route not found", req.id));
}
