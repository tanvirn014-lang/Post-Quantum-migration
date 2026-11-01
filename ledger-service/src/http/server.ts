import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerDeps } from "./deps.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { createGuards } from "./guards.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerPartnerRoutes } from "./routes/partner.js";
import { registerPeopleRoutes } from "./routes/people.js";
import { registerTransactionRoutes } from "./routes/transactions.js";

export interface BuildServerOptions {
  /** Defaults to off under NODE_ENV=test (quiet output) and on otherwise. */
  logger?: boolean;
  /** Destination for the application log; tests use it to inspect what is (and is not) logged. */
  logStream?: NodeJS.WritableStream;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function buildServer(deps: ServerDeps, opts: BuildServerOptions = {}): FastifyInstance {
  const { config } = deps;
  const loggerEnabled = opts.logger ?? config.nodeEnv !== "test";

  const app = Fastify({
    bodyLimit: 100 * 1024,
    // Honour a well-formed caller-supplied id so a request can be traced across services.
    genReqId: (req) => {
      const supplied = req.headers["x-request-id"];
      return typeof supplied === "string" && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
    },
    logger: loggerEnabled
      ? {
          level: process.env["LOG_LEVEL"] ?? "info",
          redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
          ...(opts.logStream ? { stream: opts.logStream } : {}),
          ...(config.nodeEnv === "development" ? { transport: { target: "pino-pretty" } } : {}),
        }
      : false,
  });

  app.decorateRequest("authUser", null);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
  app.addHook("onSend", async (req, reply) => {
    void reply.header("x-request-id", req.id);
  });
  // Minimal dependency-free Prometheus metrics: a request counter by method and status.
  const requestCounts = new Map<string, number>();
  app.addHook("onResponse", async (req, reply) => {
    const key = `${req.method}|${reply.statusCode}`;
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  });

  app.register(helmet, { crossOriginResourcePolicy: { policy: "same-site" } });
  app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-request-id"],
    exposedHeaders: ["x-request-id"],
    maxAge: 600,
  });
  app.register(cookie);
  app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: "1 minute",
    errorResponseBuilder: () => Object.assign(new Error("rate limited"), { statusCode: 429 }),
  });

  const guards = createGuards(deps.identity, deps.audit);
  const routeDeps = { ...deps, guards };

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/livez", async () => ({ status: "alive" }));
  app.get("/readyz", async (_req, reply) => {
    try {
      if (deps.ping) await deps.ping();
      return { status: "ready" };
    } catch {
      void reply.status(503);
      return { status: "not-ready" };
    }
  });
  app.get("/metrics", async (_req, reply) => {
    let out = "# HELP http_requests_total Total HTTP requests handled.\n# TYPE http_requests_total counter\n";
    for (const [key, count] of requestCounts) {
      const [method, status] = key.split("|");
      out += `http_requests_total{method="${method}",status="${status}"} ${count}\n`;
    }
    void reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return out;
  });

  app.register(registerAuthRoutes(routeDeps));
  app.register(registerPeopleRoutes(routeDeps));
  app.register(registerAccountRoutes(routeDeps));
  app.register(registerTransactionRoutes(routeDeps));
  app.register(registerAuditRoutes(routeDeps));
  app.register(registerPartnerRoutes(routeDeps));

  return app;
}
