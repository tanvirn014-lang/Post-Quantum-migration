import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import pino from "pino";
import { loadConfig } from "./config.js";
import { ConfigClient, TelemetryClient, sendHeartbeat } from "./sidecar/control-plane.js";
import { Sidecar } from "./sidecar/server.js";

async function main(): Promise<void> {
  const env = loadConfig();
  const logger = pino({
    level: env.LOG_LEVEL,
    redact: ["*.key", "*.token", "*.secret"],
    ...(env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : {}),
  });

  const instanceId = env.INSTANCE_ID ?? `sidecar-${os.hostname()}-${randomUUID().slice(0, 8)}`;
  const control = { baseUrl: env.SECURITY_SERVICE_URL, token: env.SIDECAR_TOKEN, logger };
  const telemetry = new TelemetryClient(control);

  const sidecar = new Sidecar({
    host: env.SIDECAR_HOST,
    port: env.SIDECAR_PORT,
    tls: {
      keyPem: await readFile(env.TLS_KEY_FILE, "utf8"),
      certPem: await readFile(env.TLS_CERT_FILE, "utf8"),
      peerCaPem: await readFile(env.PEER_CA_FILE, "utf8"),
    },
    upstreamUrl: new URL(env.UPSTREAM_URL),
    assertionSecret: env.SIDECAR_ASSERTION_SECRET,
    instanceId,
    events: telemetry,
    logger,
    maxConnections: env.MAX_CONNECTIONS,
    handshakeTimeoutMs: env.HANDSHAKE_TIMEOUT_MS,
  });

  const configClient = new ConfigClient(control, (cfg) => {
    const result = sidecar.applyConfig(cfg);
    if (result.applied) void heartbeat();
    return result;
  });

  const heartbeat = async (): Promise<void> => {
    const s = sidecar.status();
    if (s.appliedConfigVersion === null || s.activeProfile === null) return;
    await sendHeartbeat(control, {
      instanceId,
      startedAt: s.startedAt,
      appliedConfigVersion: s.appliedConfigVersion,
      activeProfile: s.activeProfile,
      runtime: { node: process.versions.node, openssl: process.versions.openssl, platform: process.platform, arch: process.arch },
      listener: { host: env.SIDECAR_HOST, port: sidecar.port, minVersion: "TLSv1.3", groups: s.groups, upstream: env.UPSTREAM_URL },
      counters: { ...s.counters, telemetryQueued: telemetry.queued, telemetryDropped: telemetry.dropped, telemetrySent: telemetry.sent, configPollFailures: configClient.consecutiveFailures },
    });
  };

  // Never listen before a configuration is applied: with no policy the sidecar must refuse everything.
  logger.info({ controlPlane: env.SECURITY_SERVICE_URL }, "waiting for initial configuration");
  await configClient.waitForInitialConfig(env.INITIAL_CONFIG_TIMEOUT_MS);
  await sidecar.start();
  configClient.start(env.CONFIG_POLL_MS);
  telemetry.start();
  const heartbeatTimer = setInterval(() => void heartbeat(), env.HEARTBEAT_MS);
  await heartbeat();

  const admin = http.createServer((req, res) => {
    const status = sidecar.status();
    const body = req.url === "/healthz" ? { status: status.ready ? "ok" : "starting" } : req.url === "/status" ? { ...status, controlPlane: { lastConfigSuccessAt: configClient.lastSuccessAt?.toISOString() ?? null, consecutiveFailures: configClient.consecutiveFailures, telemetryQueued: telemetry.queued, telemetryDropped: telemetry.dropped } } : null;
    res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? { error: "not found" }));
  });
  admin.listen(env.SIDECAR_ADMIN_PORT, "127.0.0.1", () => logger.info({ port: env.SIDECAR_ADMIN_PORT }, "admin status endpoint (loopback only)"));

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    clearInterval(heartbeatTimer);
    configClient.stop();
    await sidecar.stop();
    await telemetry.stop();
    admin.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
