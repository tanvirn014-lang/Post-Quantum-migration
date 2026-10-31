import type pg from "pg";
import type { Queryable } from "../db/pool.js";
import type { Comparison, GroundTruthItem } from "../cbom/compare.js";
import type { ObservedInventory } from "../cbom/generator.js";
import type { ValidationResult } from "../cbom/validate.js";

export interface CbomDocumentMeta {
  id: string;
  generatedAt: Date;
  generatedBy: string | null;
  specVersion: string;
  serialNumber: string;
  contentSha256: string;
  assetCount: number;
  declaredCount: number;
  observedCount: number;
  lookbackHours: number;
  validation: ValidationResult;
  sourceSummary: Record<string, unknown>;
}

export interface GroundTruthRecord {
  version: number;
  createdAt: Date;
  createdBy: string | null;
  scope: string;
  preparedBy: string;
  items: GroundTruthItem[];
  itemCount: number;
  contentSha256: string;
}

export interface ComparisonRecord {
  id: string;
  cbomId: string;
  groundTruthVersion: number;
  createdAt: Date;
  createdBy: string | null;
  metrics: Comparison["metrics"];
  discrepancies: Comparison["discrepancies"];
}

interface DocRow {
  id: string;
  generated_at: Date;
  generated_by: string | null;
  spec_version: string;
  serial_number: string;
  content_sha256: string;
  asset_count: number;
  declared_count: number;
  observed_count: number;
  lookback_hours: number;
  validation: ValidationResult;
  source_summary: Record<string, unknown>;
}

interface GtRow {
  version: string;
  created_at: Date;
  created_by: string | null;
  scope: string;
  prepared_by: string;
  items: GroundTruthItem[];
  item_count: number;
  content_sha256: string;
}

interface CmpRow {
  id: string;
  cbom_id: string;
  ground_truth_version: string;
  created_at: Date;
  created_by: string | null;
  metrics: Comparison["metrics"];
  discrepancies: Comparison["discrepancies"];
}

const mapDoc = (r: DocRow): CbomDocumentMeta => ({
  id: r.id,
  generatedAt: r.generated_at,
  generatedBy: r.generated_by,
  specVersion: r.spec_version,
  serialNumber: r.serial_number,
  contentSha256: r.content_sha256,
  assetCount: r.asset_count,
  declaredCount: r.declared_count,
  observedCount: r.observed_count,
  lookbackHours: r.lookback_hours,
  validation: r.validation,
  sourceSummary: r.source_summary,
});

const mapGt = (r: GtRow): GroundTruthRecord => ({
  version: Number(r.version),
  createdAt: r.created_at,
  createdBy: r.created_by,
  scope: r.scope,
  preparedBy: r.prepared_by,
  items: r.items,
  itemCount: r.item_count,
  contentSha256: r.content_sha256,
});

const mapCmp = (r: CmpRow): ComparisonRecord => ({
  id: r.id,
  cbomId: r.cbom_id,
  groundTruthVersion: Number(r.ground_truth_version),
  createdAt: r.created_at,
  createdBy: r.created_by,
  metrics: r.metrics,
  discrepancies: r.discrepancies,
});

const DOC_COLUMNS = "id, generated_at, generated_by, spec_version, serial_number, content_sha256, asset_count, declared_count, observed_count, lookback_hours, validation, source_summary";

export class CbomRepository {
  constructor(private readonly pool: pg.Pool) {}

  async insertDocument(
    db: Queryable,
    rec: { id: string; generatedBy: string | null; serialNumber: string; specVersion: string; contentSha256: string; document: unknown; assetCount: number; declaredCount: number; observedCount: number; lookbackHours: number; validation: ValidationResult; sourceSummary: Record<string, unknown> },
  ): Promise<CbomDocumentMeta> {
    const { rows } = await db.query<DocRow>(
      `INSERT INTO cbom_documents
         (id, generated_by, spec_version, serial_number, content_sha256, document, asset_count, declared_count, observed_count, lookback_hours, validation, source_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${DOC_COLUMNS}`,
      [rec.id, rec.generatedBy, rec.specVersion, rec.serialNumber, rec.contentSha256, JSON.stringify(rec.document), rec.assetCount, rec.declaredCount, rec.observedCount, rec.lookbackHours, JSON.stringify(rec.validation), JSON.stringify(rec.sourceSummary)],
    );
    return mapDoc(rows[0]!);
  }

  async listDocuments(limit: number): Promise<CbomDocumentMeta[]> {
    const { rows } = await this.pool.query<DocRow>(`SELECT ${DOC_COLUMNS} FROM cbom_documents ORDER BY generated_at DESC, id LIMIT $1`, [limit]);
    return rows.map(mapDoc);
  }

  async getDocumentMeta(id: string): Promise<CbomDocumentMeta | null> {
    const { rows } = await this.pool.query<DocRow>(`SELECT ${DOC_COLUMNS} FROM cbom_documents WHERE id = $1`, [id]);
    return rows[0] ? mapDoc(rows[0]) : null;
  }

  async getDocumentBody(id: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pool.query<{ document: Record<string, unknown> }>("SELECT document FROM cbom_documents WHERE id = $1", [id]);
    return rows[0]?.document ?? null;
  }

  async latestGroundTruth(db: Queryable = this.pool): Promise<GroundTruthRecord | null> {
    const { rows } = await db.query<GtRow>("SELECT * FROM cbom_ground_truth ORDER BY version DESC LIMIT 1");
    return rows[0] ? mapGt(rows[0]) : null;
  }

  async getGroundTruth(version: number): Promise<GroundTruthRecord | null> {
    const { rows } = await this.pool.query<GtRow>("SELECT * FROM cbom_ground_truth WHERE version = $1", [version]);
    return rows[0] ? mapGt(rows[0]) : null;
  }

  async insertGroundTruth(db: Queryable, rec: { createdBy: string | null; scope: string; preparedBy: string; items: GroundTruthItem[]; contentSha256: string }): Promise<GroundTruthRecord> {
    const { rows } = await db.query<GtRow>(
      `INSERT INTO cbom_ground_truth (created_by, scope, prepared_by, items, item_count, content_sha256)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [rec.createdBy, rec.scope, rec.preparedBy, JSON.stringify(rec.items), rec.items.length, rec.contentSha256],
    );
    return mapGt(rows[0]!);
  }

  async insertComparison(db: Queryable, rec: { id: string; cbomId: string; groundTruthVersion: number; createdBy: string | null; comparison: Comparison }): Promise<ComparisonRecord> {
    const { rows } = await db.query<CmpRow>(
      `INSERT INTO cbom_comparisons (id, cbom_id, ground_truth_version, created_by, metrics, discrepancies)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [rec.id, rec.cbomId, rec.groundTruthVersion, rec.createdBy, JSON.stringify(rec.comparison.metrics), JSON.stringify(rec.comparison.discrepancies)],
    );
    return mapCmp(rows[0]!);
  }

  async latestComparison(cbomId: string): Promise<ComparisonRecord | null> {
    const { rows } = await this.pool.query<CmpRow>("SELECT * FROM cbom_comparisons WHERE cbom_id = $1 ORDER BY created_at DESC, id LIMIT 1", [cbomId]);
    return rows[0] ? mapCmp(rows[0]) : null;
  }

  /** Distinct (group, cipher, version) tuples with counts in the window, plus sidecar runtime versions. */
  async observedInventory(lookbackHours: number): Promise<ObservedInventory> {
    const since = new Date(Date.now() - lookbackHours * 3_600_000);
    const [tuples, runtimes, total] = await Promise.all([
      this.pool.query<{ negotiated_group: string | null; cipher: string | null; tls_version: string | null; n: number }>(
        `SELECT negotiated_group, cipher, tls_version, count(*)::int AS n FROM connection_events
         WHERE occurred_at >= $1 AND (negotiated_group IS NOT NULL OR cipher IS NOT NULL OR tls_version IS NOT NULL)
         GROUP BY negotiated_group, cipher, tls_version ORDER BY negotiated_group NULLS LAST, cipher NULLS LAST, tls_version NULLS LAST`,
        [since],
      ),
      this.pool.query<{ instance_id: string; runtime: { node?: string; openssl?: string } }>("SELECT instance_id, runtime FROM sidecar_instances ORDER BY instance_id"),
      this.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM connection_events WHERE occurred_at >= $1", [since]),
    ]);
    return {
      lookbackHours,
      totalEvents: total.rows[0]?.n ?? 0,
      connections: tuples.rows.map((r) => ({ negotiatedGroup: r.negotiated_group, cipher: r.cipher, tlsVersion: r.tls_version, count: r.n })),
      runtimes: runtimes.rows.map((r) => ({
        instanceId: r.instance_id,
        ...(typeof r.runtime.node === "string" ? { node: r.runtime.node } : {}),
        ...(typeof r.runtime.openssl === "string" ? { openssl: r.runtime.openssl } : {}),
      })),
    };
  }
}
