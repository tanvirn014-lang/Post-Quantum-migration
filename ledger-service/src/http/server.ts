import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { LedgerService } from "../app/ledger-service.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerTransactionRoutes } from "./routes/transactions.js";

export interface BuildServerOptions {
  /** Defaults to false in tests (quiet output) and pretty-printed otherwise. */
  logger?: boolean;
  /** Defaults to true. The web frontend is a separate origin (a different port in dev),
   *  so the browser needs CORS headers to call this API at all. */
  cors?: boolean;
}

export function buildServer(service: LedgerService, opts: BuildServerOptions = {}): FastifyInstance {
  const loggerEnabled = opts.logger ?? process.env["NODE_ENV"] !== "test";
  const corsEnabled = opts.cors ?? true;
  const app = Fastify({
    logger: loggerEnabled ? { transport: { target: "pino-pretty" } } : false,
  });

  if (corsEnabled) {
    app.register(cors, { origin: true });
  }

  app.get("/healthz", async () => ({ status: "ok" }));

  app.register(registerAccountRoutes(service));
  app.register(registerTransactionRoutes(service));

  return app;
}
