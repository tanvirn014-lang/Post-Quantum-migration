import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { QUANTUM_ASSUMPTIONS } from "../../hndl/simulator.js";
import { assessBenchmarkIntegrity } from "../../domain/benchmark-integrity.js";
import type { BenchmarkIndexEntry, BenchmarkRecord, StoredHndlRun } from "../../repos/research.js";
import type { RouteDeps } from "../deps.js";
import { requestMeta, requirePrincipal } from "../guards.js";

const hndlBody = z.object({ message: z.string().min(1).max(256), quantumAssumption: z.enum(QUANTUM_ASSUMPTIONS as [string, ...string[]]) });
const moscaBody = z.object({ shelfLifeYears: z.number().min(0).max(100), migrationYears: z.number().min(0).max(100), yearsToQuantum: z.number().min(0).max(100) });
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const runIdParam = z.object({ runId: z.string().regex(/^[A-Za-z0-9._-]{8,80}$/) });
const csvParams = runIdParam.extend({ which: z.enum(["handshakes", "throughput"]) });

const csvText = z.string().min(1).max(8 * 1024 * 1024);
const benchmarkBody = z.object({
  runId: runIdParam.shape.runId,
  label: z.string().min(1).max(120),
  manifest: z.record(z.string(), z.unknown()),
  summary: z.record(z.string(), z.unknown()),
  handshakesCsv: csvText,
  throughputCsv: csvText,
});

/** The list is a light index: the summary is used only to derive integrity and is not returned. */
function toIndexDTO(b: BenchmarkIndexEntry) {
  const { summary, receivedAt, ...rest } = b;
  return { ...rest, receivedAt: receivedAt.toISOString(), integrity: assessBenchmarkIntegrity(summary) };
}

const toDetailDTO = (b: BenchmarkRecord) => ({ ...toIndexDTO(b), manifest: b.manifest, summary: b.summary });

const toHndlDTO = (r: StoredHndlRun) => ({ id: r.id, createdAt: r.createdAt.toISOString(), ...r.result });

/**
 * HNDL educational simulator (auditors and security admins may run it: it is computation on
 * throw-away keys, not a change to the system), and benchmark evidence: machine ingestion with a
 * dedicated service token, read APIs for staff.
 */
export function registerResearchRoutes(deps: RouteDeps): FastifyPluginAsync {
  const { guards, researchService, config } = deps;
  const benchOnly = guards.service("benchmark", () => config.benchToken);
  const runHndl = [guards.authenticate, guards.can("hndl:run")];
  const readBench = [guards.authenticate, guards.can("benchmarks:read")];

  return async (app) => {
    app.post("/v1/hndl/run", { preHandler: runHndl }, async (req, reply) => {
      const body = hndlBody.parse(req.body);
      const stored = await researchService.runHndl(requirePrincipal(req), { message: body.message, quantumAssumption: body.quantumAssumption as (typeof QUANTUM_ASSUMPTIONS)[number] }, requestMeta(req));
      void reply.status(201).send(toHndlDTO(stored));
    });

    app.get("/v1/hndl/runs", { preHandler: runHndl }, async (req) => {
      const { limit } = listQuery.parse(req.query);
      return (await researchService.listHndl(limit)).map(toHndlDTO);
    });

    app.post("/v1/hndl/mosca", { preHandler: runHndl }, async (req) => researchService.mosca(moscaBody.parse(req.body)));

    app.get("/v1/benchmarks", { preHandler: readBench }, async (req) => {
      const { limit } = listQuery.parse(req.query);
      return (await researchService.listBenchmarks(limit)).map(toIndexDTO);
    });

    app.get("/v1/benchmarks/:runId", { preHandler: readBench }, async (req) => {
      const { runId } = runIdParam.parse(req.params);
      return toDetailDTO(await researchService.benchmark(runId));
    });

    app.get("/v1/benchmarks/:runId/:which.csv", { preHandler: readBench }, async (req, reply) => {
      const { runId, which } = csvParams.parse(req.params);
      const csv = await researchService.benchmarkCsv(runId, which);
      void reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${runId}-${which}.csv"`)
        .send(csv);
    });

    // Raw per-handshake CSVs make a standard run roughly a megabyte, above the default body limit.
    app.post("/internal/v1/benchmarks", { preHandler: [benchOnly], bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
      const body = benchmarkBody.parse(req.body);
      await researchService.ingestBenchmark(body, requestMeta(req));
      void reply.status(201).send({ runId: body.runId });
    });
  };
}
