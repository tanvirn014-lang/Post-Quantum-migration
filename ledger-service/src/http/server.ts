import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { LedgerService } from "../app/ledger-service.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerTransactionRoutes } from "./routes/transactions.js";

export interface BuildServerOptions {
  /** Defaults to false in tests (quiet output) and pretty-printed otherwise. */
  logger?: boolean;
  /** Fastify's cors `origin` option. Defaults to the CORS_ORIGIN environment variable (a
   *  comma-separated allow-list) when set, otherwise `true` (reflects any origin) - the web
   *  frontend is a separate origin, so the browser needs CORS headers to call this API at
   *  all, but a production deployment should set CORS_ORIGIN rather than rely on that
   *  wildcard-equivalent default. Pass `false` to disable CORS entirely. */
  cors?: boolean | string[];
}

function corsOriginFromEnv(): string[] | undefined {
  const raw = process.env["CORS_ORIGIN"];
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function buildServer(service: LedgerService, opts: BuildServerOptions = {}): FastifyInstance {
  const loggerEnabled = opts.logger ?? process.env["NODE_ENV"] !== "test";
  const corsOrigin = opts.cors ?? corsOriginFromEnv() ?? true;
  const app = Fastify({
    logger: loggerEnabled ? { transport: { target: "pino-pretty" } } : false,
  });

  if (corsOrigin !== false) {
    app.register(cors, { origin: corsOrigin });
  }

  app.get("/healthz", async () => ({ status: "ok" }));

  app.register(registerAccountRoutes(service));
  app.register(registerTransactionRoutes(service));

  return app;
}
