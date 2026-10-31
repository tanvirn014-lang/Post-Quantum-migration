import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuditService } from "../../app/audit-service.js";
import type { LedgerService } from "../../app/ledger-service.js";
import { AccountNotFoundError } from "../../domain/errors.js";
import type { Account } from "../../domain/ledger.js";
import { CustomerNotFoundError } from "../../identity/errors.js";
import { hasPermission } from "../../identity/roles.js";
import type { User } from "../../identity/types.js";
import { toAccountDTO, toPostingDTO } from "../dto.js";
import type { RouteDeps } from "../deps.js";
import { requestContext, requireUser } from "../guards.js";
import { currencyCode, limitQuery } from "../schemas.js";

const createAccountSchema = z.object({
  ownerCustomerId: z.uuid(),
  currency: currencyCode,
  allowOverdraft: z.boolean().optional(),
  kind: z.enum(["current", "savings", "settlement"]).optional(),
});

const listQuerySchema = z.object({
  customerId: z.uuid().optional(),
  limit: limitQuery(200, 100),
});

const postingsQuerySchema = z.object({ limit: limitQuery(500, 50) });

export function userOwnsAccount(user: User, account: Account): boolean {
  return user.customerId !== null && account.ownerCustomerId === user.customerId;
}

/**
 * Resolves an account the caller is allowed to see. Staff with `account:read:any` see all;
 * customers see only their own. A customer asking for someone else's account gets the same
 * 404 as for a nonexistent one (no existence oracle), and the attempt is audited.
 */
export async function loadReadableAccount(
  ledger: LedgerService,
  audit: AuditService,
  req: FastifyRequest,
  user: User,
  accountId: string,
): Promise<Account> {
  const account = await ledger.getAccount(accountId);
  if (!account) throw new AccountNotFoundError(accountId);
  if (hasPermission(user.role, "account:read:any")) return account;
  if (hasPermission(user.role, "account:read:own") && userOwnsAccount(user, account)) return account;
  await audit.record({
    actorUserId: user.id,
    actorRole: user.role,
    action: "authz.denied",
    outcome: "denied",
    ...requestContext(req),
    resourceType: "account",
    resourceId: accountId,
    details: { permission: "account:read" },
  });
  throw new AccountNotFoundError(accountId);
}

export function registerAccountRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { ledger, audit, identity, guards } = deps;

  return async (app) => {
    app.post("/accounts", { preHandler: [guards.authenticate, guards.can("account:create")] }, async (req, reply) => {
      const user = requireUser(req);
      const body = createAccountSchema.parse(req.body);
      if (!(await identity.getCustomer(body.ownerCustomerId))) throw new CustomerNotFoundError(body.ownerCustomerId);
      const account = await ledger.createAccount({
        ownerCustomerId: body.ownerCustomerId,
        currency: body.currency,
        ...(body.allowOverdraft !== undefined ? { allowOverdraft: body.allowOverdraft } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
      });
      await audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: "account.create",
        resourceType: "account",
        resourceId: account.id,
        outcome: "success",
        ...requestContext(req),
        details: { ownerCustomerId: account.ownerCustomerId, currency: account.currency, kind: account.kind, allowOverdraft: account.allowOverdraft },
      });
      void reply.status(201).send(toAccountDTO(account));
    });

    app.get("/accounts", { preHandler: [guards.authenticate, guards.canAny("account:read:own", "account:read:any")] }, async (req) => {
      const user = requireUser(req);
      const query = listQuerySchema.parse(req.query);
      if (hasPermission(user.role, "account:read:any")) {
        const accounts = await ledger.listAccounts({
          limit: query.limit,
          ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
        });
        return accounts.map(toAccountDTO);
      }
      if (hasPermission(user.role, "account:read:own") && user.customerId) {
        return (await ledger.listAccounts({ customerId: user.customerId, limit: query.limit })).map(toAccountDTO);
      }
      return [];
    });

    app.get<{ Params: { id: string } }>("/accounts/:id", { preHandler: [guards.authenticate] }, async (req) => {
      const account = await loadReadableAccount(ledger, audit, req, requireUser(req), req.params.id);
      return toAccountDTO(account);
    });

    app.get<{ Params: { id: string } }>("/accounts/:id/postings", { preHandler: [guards.authenticate] }, async (req) => {
      const account = await loadReadableAccount(ledger, audit, req, requireUser(req), req.params.id);
      const { limit } = postingsQuerySchema.parse(req.query);
      const postings = await ledger.listPostingsForAccount(account.id, { limit });
      return postings.map(toPostingDTO);
    });
  };
}
