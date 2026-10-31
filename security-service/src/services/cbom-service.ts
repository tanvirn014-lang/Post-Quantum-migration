import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { canonicalJson } from "../audit/chain.js";
import { compareToGroundTruth, groundTruthInputSchema, type GroundTruthInput } from "../cbom/compare.js";
import { SPEC_VERSION, buildBom, viewAssets } from "../cbom/generator.js";
import { readUsageRegister, scanCertificates, scanManifests, type CbomSourceOptions } from "../cbom/sources.js";
import { validateBom } from "../cbom/validate.js";
import { withTransaction } from "../db/pool.js";
import { NotFoundError, ValidationFailedError } from "../errors.js";
import type { AuditLog } from "../repos/audit.js";
import type { CbomDocumentMeta, CbomRepository, ComparisonRecord, GroundTruthRecord } from "../repos/cbom.js";
import type { ConfigRepository } from "../repos/config.js";
import type { Actor, RequestMeta } from "./config-service.js";

// dist/src/services/cbom-service.js -> package root is three levels up.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_GROUND_TRUTH_FILE = path.join(PACKAGE_ROOT, "ground-truth", "cbom-ground-truth.json");

// Serializes the one-time seeding of the ground truth from its file.
const GROUND_TRUTH_SEED_LOCK = 7_240_003;

const meta = (m: RequestMeta) => ({ ip: m.ip ?? null, userAgent: m.userAgent ?? null, correlationId: m.correlationId ?? null });

const groundTruthHash = (input: GroundTruthInput) => createHash("sha256").update(canonicalJson(input)).digest("hex");

export class CbomService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly repo: CbomRepository,
    private readonly audit: AuditLog,
    private readonly configRepo: ConfigRepository,
    private readonly sources: CbomSourceOptions,
    private readonly groundTruthFile: string = DEFAULT_GROUND_TRUTH_FILE,
  ) {}

  async generate(actor: Actor, lookbackHours: number, m: RequestMeta): Promise<CbomDocumentMeta> {
    const [declared, certificates, libraries, current, observed] = await Promise.all([
      readUsageRegister(this.sources),
      scanCertificates(this.sources),
      scanManifests(this.sources),
      this.configRepo.current(),
      this.repo.observedInventory(lookbackHours),
    ]);
    const profile = await this.configRepo.getProfile(current.activeProfile);
    if (!profile) throw new Error(`Active profile ${current.activeProfile} is missing from the registry`);

    const id = randomUUID();
    const result = buildBom({
      declared,
      certificates,
      libraries,
      profile: { name: profile.name, groups: profile.groups },
      observed,
      now: new Date(),
      serialNumber: `urn:uuid:${id}`,
    });
    const validation = validateBom(result.document);

    const unverified = [...declared.algorithms, ...declared.protocols, ...declared.materials].flatMap((e) => e.locations.filter((l) => l.check !== "found").map((l) => ({ entry: e.entry.name, path: l.path, check: l.check })));
    const sourceSummary = {
      declaredRegister: { path: this.sources.usageRegister, algorithms: declared.algorithms.length, protocols: declared.protocols.length, materials: declared.materials.length, unverifiedLocations: unverified },
      certificates: { read: certificates.certificates.map((c) => c.path), refused: certificates.refused, patternsWithoutFiles: certificates.unmatched },
      manifests: { read: this.sources.packageManifests.filter((p) => !libraries.missing.includes(p)), missing: libraries.missing, cryptoLibraries: libraries.libraries.map((l) => `${l.name} (${l.manifest})`) },
      activeTlsProfile: { name: profile.name, groups: profile.groups, configVersion: current.version },
      telemetry: { lookbackHours, eventsInWindow: observed.totalEvents, distinctTuples: observed.connections.length, sidecarRuntimes: observed.runtimes.length },
    };

    return withTransaction(this.pool, async (client) => {
      const stored = await this.repo.insertDocument(client, {
        id,
        generatedBy: actor.userId,
        serialNumber: `urn:uuid:${id}`,
        specVersion: SPEC_VERSION,
        contentSha256: result.contentSha256,
        document: result.document,
        assetCount: result.counts.assets,
        declaredCount: result.counts.declared,
        observedCount: result.counts.observed,
        lookbackHours,
        validation,
        sourceSummary,
      });
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "cbom.generate",
        resourceType: "cbom",
        resourceId: id,
        outcome: validation.valid ? "success" : "failure",
        ...meta(m),
        details: { assets: result.counts.assets, declared: result.counts.declared, observed: result.counts.observed, schemaValid: validation.valid, contentSha256: result.contentSha256, lookbackHours, refusedFiles: certificates.refused.length },
      });
      return stored;
    });
  }

  list(limit: number): Promise<CbomDocumentMeta[]> {
    return this.repo.listDocuments(limit);
  }

  async get(id: string): Promise<CbomDocumentMeta> {
    const doc = await this.repo.getDocumentMeta(id);
    if (!doc) throw new NotFoundError("CBOM document");
    return doc;
  }

  async document(id: string): Promise<Record<string, unknown>> {
    const doc = await this.repo.getDocumentBody(id);
    if (!doc) throw new NotFoundError("CBOM document");
    return doc;
  }

  /** The latest ground truth; the first call seeds version 1 from the checked-in file. */
  async groundTruth(): Promise<GroundTruthRecord> {
    const existing = await this.repo.latestGroundTruth();
    if (existing) return existing;
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [GROUND_TRUTH_SEED_LOCK]);
      const again = await this.repo.latestGroundTruth(client);
      if (again) return again;
      const raw = JSON.parse(await readFile(this.groundTruthFile, "utf8")) as { scope: string; preparedBy: string; excluded?: string[]; items: unknown };
      const parsed = groundTruthInputSchema.parse({
        scope: raw.excluded?.length ? `${raw.scope} Excluded from scope: ${raw.excluded.join(" ")}` : raw.scope,
        preparedBy: raw.preparedBy,
        items: raw.items,
      });
      return this.repo.insertGroundTruth(client, { createdBy: null, scope: parsed.scope, preparedBy: parsed.preparedBy, items: parsed.items, contentSha256: groundTruthHash(parsed) });
    });
  }

  async putGroundTruth(actor: Actor, body: unknown, m: RequestMeta): Promise<GroundTruthRecord> {
    const parsed = groundTruthInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationFailedError("Ground truth failed validation", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    await this.groundTruth(); // make sure version 1 (the checked-in file) exists before a new version is added
    return withTransaction(this.pool, async (client) => {
      const record = await this.repo.insertGroundTruth(client, { createdBy: actor.userId, scope: parsed.data.scope, preparedBy: parsed.data.preparedBy, items: parsed.data.items, contentSha256: groundTruthHash(parsed.data) });
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "cbom.ground_truth.put",
        resourceType: "cbom_ground_truth",
        resourceId: String(record.version),
        outcome: "success",
        ...meta(m),
        details: { version: record.version, items: record.itemCount, contentSha256: record.contentSha256, preparedBy: record.preparedBy },
      });
      return record;
    });
  }

  async compare(actor: Actor, cbomId: string, m: RequestMeta): Promise<ComparisonRecord> {
    const document = await this.repo.getDocumentBody(cbomId);
    if (!document) throw new NotFoundError("CBOM document");
    const groundTruth = await this.groundTruth();
    const comparison = compareToGroundTruth(viewAssets(document), groundTruth.items);
    return withTransaction(this.pool, async (client) => {
      const stored = await this.repo.insertComparison(client, { id: randomUUID(), cbomId, groundTruthVersion: groundTruth.version, createdBy: actor.userId, comparison });
      await this.audit.recordIn(client, {
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "cbom.compare",
        resourceType: "cbom",
        resourceId: cbomId,
        outcome: "success",
        ...meta(m),
        details: {
          groundTruthVersion: groundTruth.version,
          completeness: comparison.metrics.completeness,
          precision: comparison.metrics.precision,
          truePositives: comparison.metrics.truePositives,
          falsePositives: comparison.metrics.falsePositives,
          falseNegatives: comparison.metrics.falseNegatives,
        },
      });
      return stored;
    });
  }

  async comparison(cbomId: string): Promise<ComparisonRecord> {
    await this.get(cbomId);
    const cmp = await this.repo.latestComparison(cbomId);
    if (!cmp) throw new NotFoundError("Comparison for this CBOM (run POST /v1/cbom/:id/compare first)");
    return cmp;
  }
}
