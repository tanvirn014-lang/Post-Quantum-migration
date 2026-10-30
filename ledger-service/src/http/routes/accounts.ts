import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { LedgerService } from "../../app/ledger-service.js";
import { AccountNotFoundError } from "../../domain/errors.js";
import { toAccountDTO, toPostingDTO } from "../dto.js";
import { sendError } from "../errors.js";
import { currencyCode } from "../schemas.js";

const createAccountSchema = z.object({
  ownerCustomerId: z.string().uuid(),
  currency: currencyCode,
  allowOverdraft: z.boolean().optional(),
});

export function registerAccountRoutes(service: LedgerService): FastifyPluginAsync {
  return async (app) => {
    app.post("/accounts", async (req, reply) => {
      try {
        const body = createAccountSchema.parse(req.body);
        const account = await service.createAccount({
          ownerCustomerId: body.ownerCustomerId,
          currency: body.currency,
          ...(body.allowOverdraft !== undefined ? { allowOverdraft: body.allowOverdraft } : {}),
        });
        reply.status(201).send(toAccountDTO(account));
      } catch (err) {
        sendError(reply, err);
      }
    });

    app.get<{ Params: { id: string } }>("/accounts/:id", async (req, reply) => {
      try {
        const account = await service.getAccount(req.params.id);
        if (!account) throw new AccountNotFoundError(req.params.id);
        reply.send(toAccountDTO(account));
      } catch (err) {
        sendError(reply, err);
      }
    });

    app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
      "/accounts/:id/postings",
      async (req, reply) => {
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const postings = await service.listPostingsForAccount(req.params.id, limit ? { limit } : undefined);
        reply.send(postings.map(toPostingDTO));
      },
    );
  };
}
