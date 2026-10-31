import { createHash } from "node:crypto";
import type { Queryable } from "../db/pool.js";
import type { HndlRun, QuantumAssumption } from "../hndl/simulator.js";

export interface StoredHndlRun {
  id: string;
  createdAt: Date;
  createdBy: string | null;
  assumption: QuantumAssumption;
  result: HndlRun;
}

interface HndlRow {
  id: string;
  created_at: Date;
  created_by: string | null;
  quantum_assumption: QuantumAssumption;
  result: HndlRun;
}

const mapHndl = (r: HndlRow): StoredHndlRun => ({ id: r.id, createdAt: r.created_at, createdBy: r.created_by, assumption: r.quantum_assumption, result: r.result });

export class HndlRepository {
  constructor(private readonly db: Queryable) {}

  async insert(db: Queryable, run: { id: string; createdBy: string; assumption: QuantumAssumption; result: HndlRun }): Promise<StoredHndlRun> {
    const { rows } = await db.query<HndlRow>(
      "INSERT INTO hndl_runs (id, created_by, quantum_assumption, result) VALUES ($1, $2, $3, $4) RETURNING *",
      [run.id, run.createdBy, run.assumption, JSON.stringify(run.result)],
    );
    return mapHndl(rows[0]!);
  }

  async list(limit: number): Promise<StoredHndlRun[]> {
    const { rows } = await this.db.query<HndlRow>("SELECT * FROM hndl_runs ORDER BY created_at DESC LIMIT $1", [limit]);
    return rows.map(mapHndl);
  }
}

export interface BenchmarkInput {
  runId: string;
  label: string;
  manifest: Record<string, unknown>;
  summary: Record<string, unknown>;
  handshakesCsv: string;
  throughputCsv: string;
}

export interface BenchmarkIndexEntry {
  runId: string;
  receivedAt: Date;
  label: string;
  commit: string | null;
  workingTreeDirty: boolean | null;
  csv: { handshakes: { bytes: number; sha256: string }; throughput: { bytes: number; sha256: string } };
}

export interface BenchmarkRecord extends BenchmarkIndexEntry {
  manifest: Record<string, unknown>;
  summary: Record<string, unknown>;
}

interface IndexRow {
  run_id: string;
  received_at: Date;
  label: string;
  source_commit: string | null;
  working_tree_dirty: boolean | null;
  handshakes_bytes: string;
  handshakes_csv_sha256: string;
  throughput_bytes: string;
  throughput_csv_sha256: string;
}

interface FullRow extends IndexRow {
  manifest: Record<string, unknown>;
  summary: Record<string, unknown>;
}

const INDEX_COLUMNS =
  "run_id, received_at, label, source_commit, working_tree_dirty, handshakes_csv_sha256, throughput_csv_sha256, octet_length(handshakes_csv) AS handshakes_bytes, octet_length(throughput_csv) AS throughput_bytes";

const mapIndex = (r: IndexRow): BenchmarkIndexEntry => ({
  runId: r.run_id,
  receivedAt: r.received_at,
  label: r.label,
  commit: r.source_commit,
  workingTreeDirty: r.working_tree_dirty,
  csv: {
    handshakes: { bytes: Number(r.handshakes_bytes), sha256: r.handshakes_csv_sha256 },
    throughput: { bytes: Number(r.throughput_bytes), sha256: r.throughput_csv_sha256 },
  },
});

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export class BenchmarkRepository {
  constructor(private readonly db: Queryable) {}

  /** Returns false when the run id already exists: evidence is never overwritten. */
  async insert(db: Queryable, input: BenchmarkInput): Promise<boolean> {
    const sourceRevision = (input.manifest["sourceRevision"] ?? {}) as { commit?: unknown; workingTreeDirty?: unknown };
    const { rowCount } = await db.query(
      `INSERT INTO benchmark_runs (run_id, label, source_commit, working_tree_dirty, manifest, summary, handshakes_csv, handshakes_csv_sha256, throughput_csv, throughput_csv_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (run_id) DO NOTHING`,
      [
        input.runId,
        input.label,
        typeof sourceRevision.commit === "string" ? sourceRevision.commit : null,
        typeof sourceRevision.workingTreeDirty === "boolean" ? sourceRevision.workingTreeDirty : null,
        JSON.stringify(input.manifest),
        JSON.stringify(input.summary),
        input.handshakesCsv,
        sha256(input.handshakesCsv),
        input.throughputCsv,
        sha256(input.throughputCsv),
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  async list(limit: number): Promise<BenchmarkIndexEntry[]> {
    const { rows } = await this.db.query<IndexRow>(`SELECT ${INDEX_COLUMNS} FROM benchmark_runs ORDER BY received_at DESC LIMIT $1`, [limit]);
    return rows.map(mapIndex);
  }

  async get(runId: string): Promise<BenchmarkRecord | null> {
    const { rows } = await this.db.query<FullRow>(`SELECT ${INDEX_COLUMNS}, manifest, summary FROM benchmark_runs WHERE run_id = $1`, [runId]);
    const row = rows[0];
    return row ? { ...mapIndex(row), manifest: row.manifest, summary: row.summary } : null;
  }

  async csv(runId: string, which: "handshakes" | "throughput"): Promise<string | null> {
    const column = which === "handshakes" ? "handshakes_csv" : "throughput_csv";
    const { rows } = await this.db.query<{ csv: string }>(`SELECT ${column} AS csv FROM benchmark_runs WHERE run_id = $1`, [runId]);
    return rows[0]?.csv ?? null;
  }
}
