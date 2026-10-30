import Fastify, { type FastifyInstance } from "fastify";
import type { LedgerService } from "../app/ledger-service.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerTransactionRoutes } from "./routes/transactions.js";

export interface BuildServerOptions {
  /** Defaults to false in tests (quiet output) and pretty-printed otherwise. */
  logger?: boolean;
}

export function buildServer(service: LedgerService, opts: BuildServerOptions = {}): FastifyInstance {
  const loggerEnabled = opts.logger ?? process.env["NODE_ENV"] !== "test";
  const app = Fastify({
    logger: loggerEnabled ? { transport: { target: "pino-pretty" } } : false,
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.register(registerAccountRoutes(service));
  app.register(registerTransactionRoutes(service));

  return app;
}
