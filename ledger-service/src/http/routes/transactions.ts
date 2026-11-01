import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { MissingIdempotencyKeyError, SameAccountTransferError, TransactionNotFoundError } from "../../domain/errors.js";
import { ForbiddenError } from "../../identity/errors.js";
import { hasPermission } from "../../identity/roles.js";
import type { User } from "../../identity/types.js";
import { toPostingDTO, toTransactionDTO } from "../dto.js";
import type { RouteDeps } from "../deps.js";
import { requestContext, requireUser } from "../guards.js";
import { accountId, currencyCode, description, idempotencyKeyHeader, positiveMinorUnitsString, signedMinorUnitsString } from "../schemas.js";
import { userOwnsAccount } from "./accounts.js";

const clientMetadata = z
  .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
  .refine((m) => Object.keys(m).length <= 10, "at most 10 metadata entries")
  .refine((m) => !("context" in m), 'the key "context" is reserved for server-attested provenance');

const journalSchema = z.object({
  description,
  postings: z
    .array(
      z.object({
        accountId,
        amountMinorUnits: signedMinorUnitsString.refine((v) => /[1-9]/.test(v), "must not be zero"),
        currency: currencyCode,
      }),
    )
    .min(2)
    .max(20),
  metadata: clientMetadata.optional(),
});

const transferSchema = z.object({
  fromAccountId: accountId,
  toAccountId: accountId,
  amountMinorUnits: positiveMinorUnitsString,
  currency: currencyCode,
  description,
  metadata: clientMetadata.optional(),
});

/**
 * The idempotency key is scoped to the authenticated user, so one user's key can never
 * replay (or collide with) another user's transaction.
 */
function scopedIdempotencyKey(req: FastifyRequest, user: User): string {
  const header = req.headers["idempotency-key"];
  if (typeof header !== "string" || header.length === 0) throw new MissingIdempotencyKeyError();
  return `${user.id}:${idempotencyKeyHeader.parse(header)}`;
}

function provenance(req: FastifyRequest, user: User) {
  return { actor: { userId: user.id, role: user.role }, channel: "api", correlationId: req.id };
}

export function registerTransactionRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { ledger, audit, guards } = deps;

  return async (app) => {
    app.post("/transfers", { preHandler: [guards.authenticate, guards.can("transfer:create:own")] }, async (req, reply) => {
      const user = requireUser(req);
      const idempotencyKey = scopedIdempotencyKey(req, user);
      const body = transferSchema.parse(req.body);

      if (body.fromAccountId === body.toAccountId) {
        throw new SameAccountTransferError();
      }
      const from = await ledger.getAccount(body.fromAccountId);
      if (!from || !userOwnsAccount(user, from)) {
        await audit.record({
          actorUserId: user.id,
          actorRole: user.role,
          action: "authz.denied",
          outcome: "denied",
          ...requestContext(req),
          resourceType: "account",
          resourceId: body.fromAccountId,
          details: { permission: "transfer:create:own" },
        });
        throw new ForbiddenError("You can only transfer from your own accounts");
      }

      const transaction = await ledger.transfer(
        {
          idempotencyKey,
          fromAccountId: body.fromAccountId,
          toAccountId: body.toAccountId,
          amountMinorUnits: BigInt(body.amountMinorUnits),
          currency: body.currency,
          description: body.description,
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
          context: provenance(req, user),
        },
        // Audited inside the posting transaction: a committed transfer always has its audit entry.
        (txn) => ({
          actorUserId: user.id,
          actorRole: user.role,
          action: "transfer.create",
          resourceType: "transaction",
          resourceId: txn.id,
          outcome: "success",
          ...requestContext(req),
          details: { from: body.fromAccountId, to: body.toAccountId, amountMinorUnits: body.amountMinorUnits, currency: body.currency },
        }),
      );
      void reply.status(201).send(toTransactionDTO(transaction));
    });

    app.post("/transactions", { preHandler: [guards.authenticate, guards.can("transaction:post:journal")] }, async (req, reply) => {
      const user = requireUser(req);
      const idempotencyKey = scopedIdempotencyKey(req, user);
      const body = journalSchema.parse(req.body);
      const transaction = await ledger.postTransaction(
        {
          idempotencyKey,
          description: body.description,
          postings: body.postings.map((p) => ({ accountId: p.accountId, amountMinorUnits: BigInt(p.amountMinorUnits), currency: p.currency })),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
          context: provenance(req, user),
        },
        (txn) => ({
          actorUserId: user.id,
          actorRole: user.role,
          action: "transaction.post",
          resourceType: "transaction",
          resourceId: txn.id,
          outcome: "success",
          ...requestContext(req),
          details: { postings: body.postings.length },
        }),
      );
      void reply.status(201).send(toTransactionDTO(transaction));
    });

    app.get<{ Params: { id: string } }>("/transactions/:id", { preHandler: [guards.authenticate] }, async (req) => {
      const user = requireUser(req);
      const result = await ledger.getTransaction(req.params.id);
      if (!result) throw new TransactionNotFoundError(req.params.id);

      let visible = hasPermission(user.role, "account:read:any");
      if (!visible && hasPermission(user.role, "account:read:own")) {
        for (const posting of result.postings) {
          const account = await ledger.getAccount(posting.accountId);
          if (account && userOwnsAccount(user, account)) {
            visible = true;
            break;
          }
        }
      }
      if (!visible) throw new TransactionNotFoundError(req.params.id);

      return { transaction: toTransactionDTO(result.transaction), postings: result.postings.map(toPostingDTO) };
    });
  };
}
