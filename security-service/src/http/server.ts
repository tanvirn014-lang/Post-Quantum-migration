import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerDeps } from "./deps.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { createGuards } from "./guards.js";
import { registerCbomRoutes } from "./routes/cbom-routes.js";
import { registerConfigRoutes } from "./routes/config-routes.js";
import { registerExperimentRoutes } from "./routes/experiment-routes.js";
import { registerInternalRoutes } from "./routes/internal-routes.js";
import { registerResearchRoutes } from "./routes/research-routes.js";
import { registerTelemetryRoutes } from "./routes/telemetry-routes.js";

export interface BuildServerOptions {
  logger?: boolean;
  /** Destination for the application log; tests use it to inspect what is (and is not) logged. */
  logStream?: NodeJS.WritableStream;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function buildServer(deps: ServerDeps, opts: BuildServerOptions = {}): FastifyInstance {
  const { config } = deps;
  const loggerEnabled = opts.logger ?? config.nodeEnv !== "test";

  const app = Fastify({
    bodyLimit: 512 * 1024,
    genReqId: (req) => {
      const supplied = req.headers["x-request-id"];
      return typeof supplied === "string" && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
    },
    logger: loggerEnabled
      ? {
          level: process.env["LOG_LEVEL"] ?? "info",
          redact: ["req.headers.authorization", "req.headers.cookie"],
          ...(opts.logStream ? { stream: opts.logStream } : {}),
          ...(config.nodeEnv === "development" ? { transport: { target: "pino-pretty" } } : {}),
        }
      : false,
  });

  app.decorateRequest("principal", null);
  app.decorateRequest("servicePrincipal", null);
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
    credentials: false,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-request-id"],
    exposedHeaders: ["x-request-id"],
    maxAge: 600,
  });
  app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: "1 minute",
    // The sidecar legitimately posts frequent small batches; its own routes are not throttled
    // by the browser-facing limit.
    allowList: (req) => req.url.startsWith("/internal/"),
    errorResponseBuilder: () => Object.assign(new Error("rate limited"), { statusCode: 429 }),
  });

  const guards = createGuards(deps.verifier, deps.audit);
  const routeDeps = { ...deps, guards };

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/livez", async () => ({ status: "alive" }));
  app.get("/readyz", async (_req, reply) => {
    try {
      await deps.pool.query("SELECT 1");
      return { status: "ready" };
    } catch {
      void reply.status(503);
      return { status: "database-unavailable" };
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

  app.register(registerConfigRoutes(routeDeps));
  app.register(registerTelemetryRoutes(routeDeps));
  app.register(registerCbomRoutes(routeDeps));
  app.register(registerExperimentRoutes(routeDeps));
  app.register(registerResearchRoutes(routeDeps));
  app.register(registerInternalRoutes(routeDeps));

  return app;
}
