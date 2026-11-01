import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { AccountNotFoundError, DomainError, MissingIdempotencyKeyError } from "../../domain/errors.js";
import { verifyAssertion, type PeerAssertion } from "../../partner/assertion.js";
import { AssertionReplayCache } from "../../partner/replay-cache.js";
import { toTransactionDTO } from "../dto.js";
import type { RouteDeps } from "../deps.js";
import { accountId, currencyCode, idempotencyKeyHeader, positiveMinorUnitsString } from "../schemas.js";

/** The bank's own customer record that owns the partner settlement account (provisioned by the seed). */
export const PARTNER_CUSTOMER_EMAIL = "partner-network@pq-bank.invalid";

export class PartnerAssertionInvalidError extends DomainError {
  constructor() {
    super("The partner assertion is missing, invalid, expired or does not match this request", "PARTNER_ASSERTION_INVALID");
  }
}
export class PartnerApiDisabledError extends DomainError {
  constructor() {
    super("The partner API is disabled on this core (SIDECAR_ASSERTION_SECRET is not set)", "PARTNER_API_DISABLED");
  }
}
export class PartnerNotProvisionedError extends DomainError {
  constructor() {
    super("The partner settlement account has not been provisioned", "PARTNER_NOT_PROVISIONED");
  }
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set on /partner routes after the sidecar's signed assertion verified. */
    partner: PeerAssertion | null;
  }
}

const reference = z
  .string()
  .min(1)
  .max(100)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]*$/, "must not contain control characters");

const paymentSchema = z.object({
  toAccountId: accountId,
  amountMinorUnits: positiveMinorUnitsString,
  currency: currencyCode,
  reference,
});

/** Rate-limit buckets per peer, not per source address: every peer arrives from the sidecar's IP. */
function peerKey(req: FastifyRequest): string {
  const header = req.headers["x-sidecar-assertion"];
  try {
    if (typeof header === "string") {
      const payload = JSON.parse(Buffer.from(header.split(".")[0] ?? "", "base64url").toString("utf8")) as { peerId?: unknown };
      if (typeof payload.peerId === "string") return `peer:${payload.peerId.slice(0, 64)}`;
    }
  } catch {
    // fall through to the address
  }
  return req.ip;
}

/**
 * Inbound partner API. It is reachable only through the sidecar: every request must carry the
 * sidecar's HMAC-signed assertion (peer identity, the TLS key exchange it verified, a fresh
 * timestamp, bound to this method and path). A caller that bypasses the sidecar cannot forge it.
 * Partners can only CREDIT customer accounts from the partner settlement account - never debit.
 */
export function registerPartnerRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { ledger, identity, config } = deps;
  const secret = config.sidecarAssertionSecret;
  const limit = { rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: peerKey } };
  // Single-use guard: an assertion's jti is accepted once. TTL is twice the 30 s freshness window,
  // after which verifyAssertion's own staleness check is the only guard needed.
  const replay = new AssertionReplayCache(60_000);

  return async (app) => {
    app.decorateRequest("partner", null);
    app.addHook("preHandler", async (req) => {
      if (!secret) throw new PartnerApiDisabledError();
      const header = req.headers["x-sidecar-assertion"];
      const assertion = typeof header === "string" ? verifyAssertion(header, secret, { method: req.method, path: req.url }) : null;
      // The sidecar only forwards accepted connections; anything else is a forged or misrouted request.
      if (!assertion || (assertion.decision !== "allowed-hybrid" && assertion.decision !== "allowed-fallback")) {
        throw new PartnerAssertionInvalidError();
      }
      // Reject a replay: the same signed assertion (its jti) cannot be used twice within the window.
      if (!replay.checkAndRecord(assertion.jti)) throw new PartnerAssertionInvalidError();
      req.partner = assertion;
    });

    app.get("/partner/v1/ping", { config: limit }, async (req) => {
      const a = req.partner!;
      return {
        ok: true,
        peer: { id: a.peerId, name: a.peerName },
        tls: { keyExchange: a.keyExchange, negotiatedGroup: a.negotiatedGroup, decision: a.decision },
        correlationId: a.correlationId,
      };
    });

    app.post("/partner/v1/payments", { config: limit }, async (req, reply) => {
      const a = req.partner!;
      const header = req.headers["idempotency-key"];
      if (typeof header !== "string" || header.length === 0) throw new MissingIdempotencyKeyError();
      const body = paymentSchema.parse(req.body);

      const partnerCustomer = await identity.findCustomerByEmail(PARTNER_CUSTOMER_EMAIL);
      const settlement = partnerCustomer
        ? (await ledger.listAccounts({ customerId: partnerCustomer.id })).find((acc) => acc.kind === "settlement" && acc.status === "active")
        : undefined;
      if (!settlement) throw new PartnerNotProvisionedError();

      const target = await ledger.getAccount(body.toAccountId);
      // Bank-internal accounts are not payable by partners, and look nonexistent to them.
      if (!target || target.kind === "settlement") throw new AccountNotFoundError(body.toAccountId);

      const transaction = await ledger.transfer(
        {
          // Scoped to the peer: one peer's key can never replay (or collide with) another's.
          idempotencyKey: `partner:${a.peerId}:${idempotencyKeyHeader.parse(header)}`,
          fromAccountId: settlement.id,
          toAccountId: target.id,
          amountMinorUnits: BigInt(body.amountMinorUnits),
          currency: body.currency,
          description: `Partner payment: ${body.reference}`,
          context: {
            channel: "partner",
            peer: { id: a.peerId, name: a.peerName },
            tls: { keyExchange: a.keyExchange, negotiatedGroup: a.negotiatedGroup, decision: a.decision },
            correlationId: a.correlationId,
          },
        },
        // Audited inside the posting transaction: a committed partner payment always has its entry.
        (txn) => ({
          actorUserId: null,
          actorRole: "partner",
          action: "partner.payment.create",
          resourceType: "transaction",
          resourceId: txn.id,
          outcome: "success",
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          correlationId: a.correlationId,
          details: {
            peerId: a.peerId,
            peerName: a.peerName,
            keyExchange: a.keyExchange,
            negotiatedGroup: a.negotiatedGroup,
            toAccountId: target.id,
            amountMinorUnits: body.amountMinorUnits,
            currency: body.currency,
          },
        }),
      );
      void reply.status(201).send(toTransactionDTO(transaction));
    });
  };
}
