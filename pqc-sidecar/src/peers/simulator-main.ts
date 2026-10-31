import { timingSafeEqual, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { z } from "zod";
import { SCENARIOS, ScenarioInputError, findScenario, runScenario, type ScenarioContext, type ScenarioParams } from "./scenarios.js";

const env = z
  .object({
    PEER_SIM_PORT: z.coerce.number().int().min(0).max(65535).default(3300),
    PEER_SIM_TOKEN: z.string().min(32),
    SIDECAR_HOST: z.string().default("127.0.0.1"),
    SIDECAR_PORT: z.coerce.number().int().min(1).max(65535).default(8443),
    PKI_DIR: z.string().default(".secrets/pki"),
  })
  .parse(process.env);

const pkiDir = path.resolve(env.PKI_DIR);
const read = (rel: string) => readFile(path.join(pkiDir, rel), "utf8");

async function loadContext(): Promise<ScenarioContext> {
  const identity = async (slug: string) => ({ certPem: await read(`peers/${slug}/cert.pem`), keyPem: await read(`peers/${slug}/key.pem`) });
  return {
    host: env.SIDECAR_HOST,
    port: env.SIDECAR_PORT,
    caPem: await read("ca.pem"),
    identities: {
      hybridBank: await identity("hybrid-bank"),
      legacyPsp: await identity("legacy-psp"),
      strictBank: await identity("strict-bank"),
      unregistered: await identity("unregistered-peer"),
      rogue: await identity("rogue"),
    },
  };
}

const sha = (s: string) => createHash("sha256").update(s).digest();
const authorized = (header: string | undefined): boolean => {
  const match = header ? /^Bearer (.+)$/.exec(header) : null;
  return Boolean(match) && timingSafeEqual(sha(match![1]!), sha(env.PEER_SIM_TOKEN));
};

const paramsSchema = z.object({ toAccountId: z.string().min(1).max(64).optional(), amountMinorUnits: z.string().regex(/^\d{1,15}$/).optional(), reference: z.string().min(1).max(100).optional() }).strict();

async function readParams(req: http.IncomingMessage): Promise<ScenarioParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 4096) throw new ScenarioInputError("request body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = paramsSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (!parsed.success) throw new ScenarioInputError("invalid scenario parameters");
  return parsed.data;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/**
 * Peer simulator service. It is the only process that holds the simulated peers' private keys,
 * and exists so experiments can be run from the dashboard through security-service. It is a
 * test tool: bearer-token protected, loopback-bound, and it can only run the fixed scenarios.
 */
const server = http.createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { status: "ok" });
      if (!authorized(req.headers.authorization)) return send(res, 401, { error: { code: "UNAUTHORIZED", message: "Invalid token" } });

      if (req.method === "GET" && req.url === "/scenarios") {
        return send(res, 200, SCENARIOS.map((s) => ({ id: s.id, title: s.title, experiment: s.experiment, description: s.description, expected: s.expected, requires: s.requires ?? [] })));
      }
      const match = req.method === "POST" ? /^\/scenarios\/([a-z0-9-]+)\/run$/.exec(req.url ?? "") : null;
      if (match) {
        const def = findScenario(match[1]!);
        if (!def) return send(res, 404, { error: { code: "NOT_FOUND", message: "Unknown scenario" } });
        const params = await readParams(req);
        return send(res, 200, await runScenario(def, { ...(await loadContext()), params }));
      }
      return send(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
    } catch (err) {
      if (err instanceof ScenarioInputError) return send(res, 400, { error: { code: "SCENARIO_INPUT", message: err.message } });
      console.error(err);
      return send(res, 500, { error: { code: "INTERNAL_ERROR", message: "Scenario failed to run" } });
    }
  })();
});

server.listen(env.PEER_SIM_PORT, "127.0.0.1", () => console.log(`peer simulator on 127.0.0.1:${env.PEER_SIM_PORT} -> sidecar ${env.SIDECAR_HOST}:${env.SIDECAR_PORT}`));
process.once("SIGINT", () => server.close(() => process.exit(0)));
process.once("SIGTERM", () => server.close(() => process.exit(0)));
