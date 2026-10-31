import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { CbomDocumentMeta, ComparisonRecord, GroundTruthRecord } from "../../repos/cbom.js";
import type { RouteDeps } from "../deps.js";
import { requestMeta, requirePrincipal } from "../guards.js";

const idParams = z.object({ id: z.uuid() });
const generateBody = z.object({ lookbackHours: z.number().int().min(1).max(720).default(24) }).default({ lookbackHours: 24 });
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

function toMetaDTO(d: CbomDocumentMeta) {
  return {
    id: d.id,
    generatedAt: d.generatedAt.toISOString(),
    generatedBy: d.generatedBy,
    specVersion: d.specVersion,
    serialNumber: d.serialNumber,
    contentSha256: d.contentSha256,
    assets: { total: d.assetCount, declared: d.declaredCount, observed: d.observedCount },
    lookbackHours: d.lookbackHours,
    validation: d.validation,
    sourceSummary: d.sourceSummary,
  };
}

function toGroundTruthDTO(g: GroundTruthRecord) {
  return {
    version: g.version,
    createdAt: g.createdAt.toISOString(),
    createdBy: g.createdBy,
    scope: g.scope,
    preparedBy: g.preparedBy,
    itemCount: g.itemCount,
    contentSha256: g.contentSha256,
    items: g.items,
  };
}

function toComparisonDTO(c: ComparisonRecord) {
  return {
    id: c.id,
    cbomId: c.cbomId,
    groundTruthVersion: c.groundTruthVersion,
    createdAt: c.createdAt.toISOString(),
    createdBy: c.createdBy,
    metrics: c.metrics,
    discrepancies: c.discrepancies,
  };
}

/** Cryptographic bill of materials: generate, list, download, compare against the manual ground truth. */
export function registerCbomRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { guards, cbomService } = deps;
  const read = [guards.authenticate, guards.can("cbom:read")];
  const write = [guards.authenticate, guards.can("cbom:generate")];

  return async (app) => {
    app.post("/v1/cbom/generate", { preHandler: write }, async (req, reply) => {
      const body = generateBody.parse(req.body ?? {});
      const doc = await cbomService.generate(requirePrincipal(req), body.lookbackHours, requestMeta(req));
      void reply.status(201).send(toMetaDTO(doc));
    });

    app.get("/v1/cbom", { preHandler: read }, async (req) => {
      const { limit } = listQuery.parse(req.query);
      return (await cbomService.list(limit)).map(toMetaDTO);
    });

    // Registered before /v1/cbom/:id so "ground-truth" is not parsed as an id.
    app.get("/v1/cbom/ground-truth", { preHandler: read }, async () => toGroundTruthDTO(await cbomService.groundTruth()));

    app.put("/v1/cbom/ground-truth", { preHandler: write }, async (req) => {
      return toGroundTruthDTO(await cbomService.putGroundTruth(requirePrincipal(req), req.body, requestMeta(req)));
    });

    app.get("/v1/cbom/:id", { preHandler: read }, async (req) => {
      const { id } = idParams.parse(req.params);
      return toMetaDTO(await cbomService.get(id));
    });

    app.get("/v1/cbom/:id/document", { preHandler: read }, async (req, reply) => {
      const { id } = idParams.parse(req.params);
      const document = await cbomService.document(id);
      void reply
        .header("content-type", "application/vnd.cyclonedx+json; charset=utf-8")
        .header("content-disposition", `attachment; filename="cbom-${id}.cdx.json"`)
        .send(JSON.stringify(document, null, 2));
    });

    app.post("/v1/cbom/:id/compare", { preHandler: write }, async (req, reply) => {
      const { id } = idParams.parse(req.params);
      const result = await cbomService.compare(requirePrincipal(req), id, requestMeta(req));
      void reply.status(201).send(toComparisonDTO(result));
    });

    app.get("/v1/cbom/:id/comparison", { preHandler: read }, async (req) => {
      const { id } = idParams.parse(req.params);
      return toComparisonDTO(await cbomService.comparison(id));
    });
  };
}
