import { randomUUID } from "node:crypto";
import type pg from "pg";
import { withTransaction } from "../db/pool.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { moscaAssessment, runHndlSimulation, type HndlInput, type MoscaInput, type MoscaResult } from "../hndl/simulator.js";
import type { AuditLog } from "../repos/audit.js";
import type { BenchmarkIndexEntry, BenchmarkInput, BenchmarkRecord, BenchmarkRepository, HndlRepository, StoredHndlRun } from "../repos/research.js";
import type { Actor, RequestMeta } from "./config-service.js";

const meta = (m: RequestMeta) => ({ ip: m.ip ?? null, userAgent: m.userAgent ?? null, correlationId: m.correlationId ?? null });

/** Educational HNDL simulator runs and ingested benchmark evidence. */
export class ResearchService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly hndl: HndlRepository,
    private readonly benchmarks: BenchmarkRepository,
    private readonly audit: AuditLog,
  ) {}

  async runHndl(actor: Actor, input: HndlInput, m: RequestMeta): Promise<StoredHndlRun> {
    const result = runHndlSimulation(input);
    const id = randomUUID();
    return withTransaction(this.pool, async (client) => {
      const stored = await this.hndl.insert(client, { id, createdBy: actor.userId, assumption: input.quantumAssumption, result });
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "hndl.run",
        resourceType: "hndl_run",
        resourceId: id,
        outcome: "success",
        ...meta(m),
        // The toy message is deliberately not copied into the audit log.
        details: { quantumAssumption: input.quantumAssumption, messageChars: input.message.length, classicalRecovered: result.sessions.classical.recovered, hybridRecovered: result.sessions.hybrid.recovered },
      });
      return stored;
    });
  }

  listHndl(limit: number): Promise<StoredHndlRun[]> {
    return this.hndl.list(limit);
  }

  mosca(input: MoscaInput): MoscaResult {
    return moscaAssessment(input);
  }

  async ingestBenchmark(input: BenchmarkInput, m: RequestMeta): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const inserted = await this.benchmarks.insert(client, input);
      if (!inserted) throw new ConflictError(`Benchmark run ${input.runId} already exists; evidence is never overwritten`, "BENCHMARK_EXISTS");
      await this.audit.recordIn(client, {
        actorUserId: null,
        actorRole: null,
        action: "benchmark.ingest",
        resourceType: "benchmark_run",
        resourceId: input.runId,
        outcome: "success",
        ...meta(m),
        details: { label: input.label, handshakesCsvChars: input.handshakesCsv.length, throughputCsvChars: input.throughputCsv.length },
      });
    });
  }

  listBenchmarks(limit: number): Promise<BenchmarkIndexEntry[]> {
    return this.benchmarks.list(limit);
  }

  async benchmark(runId: string): Promise<BenchmarkRecord> {
    const record = await this.benchmarks.get(runId);
    if (!record) throw new NotFoundError("Benchmark run");
    return record;
  }

  async benchmarkCsv(runId: string, which: "handshakes" | "throughput"): Promise<string> {
    const csv = await this.benchmarks.csv(runId, which);
    if (csv === null) throw new NotFoundError("Benchmark run");
    return csv;
  }
}
