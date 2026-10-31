import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { DomainError } from "../errors.js";

function body(code: string, message: string, requestId: string, details?: unknown) {
  return { error: { code, message, requestId, ...(details !== undefined ? { details } : {}) } };
}

/** The one place a thrown error becomes an HTTP response; same envelope as ledger-service. */
export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof DomainError) {
    void reply.status(err.status).send(body(err.code, err.message, req.id, err.details));
    return;
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    void reply.status(400).send(body("VALIDATION_ERROR", "Request failed validation", req.id, details));
    return;
  }
  const statusCode = (err as FastifyError).statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    const code = statusCode === 429 ? "RATE_LIMITED" : statusCode === 413 ? "PAYLOAD_TOO_LARGE" : statusCode === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "BAD_REQUEST";
    void reply.status(statusCode).send(body(code, statusCode === 429 ? "Too many requests, slow down" : err.message, req.id));
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.status(500).send(body("INTERNAL_ERROR", "Something went wrong", req.id));
}

export function notFoundHandler(req: FastifyRequest, reply: FastifyReply): void {
  void reply.status(404).send(body("NOT_FOUND", "Route not found", req.id));
}
