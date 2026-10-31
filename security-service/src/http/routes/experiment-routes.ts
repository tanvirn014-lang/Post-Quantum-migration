import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { DependencyUnavailableError, NotFoundError } from "../../errors.js";
import type { RouteDeps } from "../deps.js";
import { requestMeta, requirePrincipal } from "../guards.js";

// Only the payment scenarios use these; the simulator validates them again.
const paramsSchema = z
  .object({ toAccountId: z.uuid().optional(), amountMinorUnits: z.string().regex(/^[1-9]\d{0,14}$/).optional(), reference: z.string().min(1).max(100).optional() })
  .strict();
const runSchema = z.object({ scenarioId: z.string().regex(/^[a-z0-9-]{1,64}$/), params: paramsSchema.optional() });

/**
 * Runs the fixed experiment scenarios through the peer simulator, which holds the simulated
 * peers' private keys (this service never sees them). Each run is audited. The simulator is a
 * test tool: when it is not configured or reachable the API says so instead of faking a result.
 */
export function registerExperimentRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { guards, config, audit } = deps;

  async function callSimulator(path: string, init: RequestInit = {}): Promise<Response> {
    if (!config.peerSimUrl || !config.peerSimToken) {
      throw new DependencyUnavailableError("The peer simulator is not configured (PEER_SIM_URL / PEER_SIM_TOKEN).");
    }
    try {
      return await fetch(new URL(path, config.peerSimUrl), {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${config.peerSimToken}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new DependencyUnavailableError("The peer simulator is not reachable.");
    }
  }

  return async (app) => {
    app.get("/v1/experiments/scenarios", { preHandler: [guards.authenticate, guards.can("telemetry:read")] }, async () => {
      const res = await callSimulator("/scenarios");
      if (!res.ok) throw new DependencyUnavailableError("The peer simulator rejected the request.");
      return res.json();
    });

    app.post("/v1/experiments/run", { preHandler: [guards.authenticate, guards.can("experiments:run")] }, async (req) => {
      const { scenarioId, params } = runSchema.parse(req.body);
      const principal = requirePrincipal(req);
      const res = await callSimulator(`/scenarios/${scenarioId}/run`, {
        method: "POST",
        ...(params ? { headers: { "content-type": "application/json" }, body: JSON.stringify(params) } : {}),
      });
      if (res.status === 404) throw new NotFoundError("Scenario");
      if (!res.ok) throw new DependencyUnavailableError("The peer simulator failed to run the scenario.");
      const result = (await res.json()) as { passed?: boolean; observed?: string; expected?: string };
      await audit.record({
        actorUserId: principal.userId,
        actorRole: principal.role,
        action: "experiment.run",
        resourceType: "scenario",
        resourceId: scenarioId,
        outcome: result.passed ? "success" : "failure",
        ...requestMeta(req),
        details: { expected: result.expected ?? null, observed: result.observed ?? null, ...(params ? { params } : {}) },
      });
      return result;
    });
  };
}
