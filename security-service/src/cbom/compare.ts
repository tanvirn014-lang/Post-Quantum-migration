import { z } from "zod";
import type { GeneratedAssetView, Provenance } from "./generator.js";
import { ASSET_KINDS, assetKey, type AssetKind } from "./normalize.js";

const ATTRIBUTE_NAMES = ["primitive", "algorithmFamily", "parameterSetIdentifier", "ellipticCurve"] as const;

export const groundTruthItemSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(ASSET_KINDS as [AssetKind, ...AssetKind[]]),
  name: z.string().min(1).max(200),
  expectedProvenance: z.enum(["declared", "observed"]),
  /** Attributes the asset is expected to have (compared when present). */
  expected: z.object({ primitive: z.string(), algorithmFamily: z.string(), parameterSetIdentifier: z.string(), ellipticCurve: z.string() }).partial().strict().optional(),
  /** Repo-relative paths where a manual inspection found this asset in use. */
  locations: z.array(z.string().min(1).max(300)).max(60).default([]),
  notes: z.string().max(600).optional(),
});
export type GroundTruthItem = z.infer<typeof groundTruthItemSchema>;

export const groundTruthInputSchema = z
  .object({
    scope: z.string().min(1).max(4000),
    preparedBy: z.string().min(1).max(600),
    items: z.array(groundTruthItemSchema).min(1).max(500),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.items.forEach((item, i) => {
      const key = assetKey(item.kind, item.name);
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["items", i, "name"], message: `duplicate ground-truth asset (${key})` });
      seen.add(key);
    });
  });
export type GroundTruthInput = z.infer<typeof groundTruthInputSchema>;

export type DiscrepancyType = "missing" | "unexpected" | "provenance-mismatch" | "attribute-mismatch" | "location-gap";

export interface Discrepancy {
  type: DiscrepancyType;
  kind: AssetKind;
  name: string;
  detail: string;
}

export interface KindCounts {
  groundTruth: number;
  generated: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface ComparisonMetrics {
  groundTruthItems: number;
  generatedAssets: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** matched ground-truth items / ground-truth items */
  completeness: number;
  /** matched generated assets / generated assets (null when nothing was generated) */
  precision: number | null;
  denominators: { completeness: string; precision: string };
  provenanceAgreement: { matched: number; agreeing: number; ratio: number | null };
  locationRecall: { groundTruthLocations: number; found: number; ratio: number | null };
  byKind: Record<string, KindCounts>;
}

export interface Comparison {
  metrics: ComparisonMetrics;
  discrepancies: Discrepancy[];
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const ratio = (num: number, den: number) => (den === 0 ? null : round(num / den));
const normPath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

/**
 * Appendix E steps 4-6: normalize identifiers, match generated assets to ground-truth items,
 * classify true/false positives and negatives, and compute scoped completeness and precision with
 * their denominators. Only cryptographic assets take part (library components are out of scope).
 * Matching is by canonical asset identity, never by position or by fuzzy text similarity.
 */
export function compareToGroundTruth(generated: GeneratedAssetView[], groundTruth: GroundTruthItem[]): Comparison {
  const generatedByKey = new Map(generated.map((g) => [g.key, g]));
  const gtKeys = new Set(groundTruth.map((g) => assetKey(g.kind, g.name)));
  const discrepancies: Discrepancy[] = [];
  const byKind: Record<string, KindCounts> = {};
  const counts = (kind: string): KindCounts => (byKind[kind] ??= { groundTruth: 0, generated: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0 });

  let truePositives = 0;
  let agreeing = 0;
  let gtLocations = 0;
  let foundLocations = 0;

  for (const item of groundTruth) {
    const k = counts(item.kind);
    k.groundTruth += 1;
    gtLocations += item.locations.length;
    const hit = generatedByKey.get(assetKey(item.kind, item.name));
    if (!hit) {
      k.falseNegatives += 1;
      discrepancies.push({ type: "missing", kind: item.kind, name: item.name, detail: `in the ground truth (${item.expectedProvenance}) but absent from the generated CBOM${item.notes ? `. Note: ${item.notes}` : ""}` });
      continue;
    }
    truePositives += 1;
    k.truePositives += 1;

    if (hit.provenance === item.expectedProvenance) agreeing += 1;
    else discrepancies.push({ type: "provenance-mismatch", kind: item.kind, name: item.name, detail: `expected ${item.expectedProvenance}, generated ${hit.provenance}` });

    for (const attr of ATTRIBUTE_NAMES) {
      const want = item.expected?.[attr];
      if (want !== undefined && String(hit.attributes[attr] ?? "") !== want) {
        discrepancies.push({ type: "attribute-mismatch", kind: item.kind, name: item.name, detail: `${attr}: expected ${want}, generated ${hit.attributes[attr] ?? "(absent)"}` });
      }
    }

    const have = new Set(hit.locations.map(normPath));
    const absent = item.locations.filter((l) => !have.has(normPath(l)));
    foundLocations += item.locations.length - absent.length;
    if (absent.length > 0) {
      discrepancies.push({ type: "location-gap", kind: item.kind, name: item.name, detail: `${absent.length} of ${item.locations.length} ground-truth locations not in the BOM evidence: ${absent.join(", ")}` });
    }
  }

  let falsePositives = 0;
  for (const g of generated) {
    const k = counts(g.kind);
    k.generated += 1;
    if (gtKeys.has(g.key)) continue;
    falsePositives += 1;
    k.falsePositives += 1;
    discrepancies.push({ type: "unexpected", kind: g.kind, name: g.name, detail: `generated (${g.provenance}) but not in the ground truth: either the ground truth is incomplete or the generator reported something that is not in scope` });
  }

  return {
    metrics: {
      groundTruthItems: groundTruth.length,
      generatedAssets: generated.length,
      truePositives,
      falsePositives,
      falseNegatives: groundTruth.length - truePositives,
      completeness: groundTruth.length === 0 ? 0 : round(truePositives / groundTruth.length),
      precision: ratio(truePositives, generated.length),
      denominators: {
        completeness: `matched ground-truth items / ground-truth items (${truePositives} / ${groundTruth.length})`,
        precision: `matched generated assets / generated cryptographic assets (${truePositives} / ${generated.length})`,
      },
      provenanceAgreement: { matched: truePositives, agreeing, ratio: ratio(agreeing, truePositives) },
      locationRecall: { groundTruthLocations: gtLocations, found: foundLocations, ratio: ratio(foundLocations, gtLocations) },
      byKind,
    },
    discrepancies,
  };
}

export type { Provenance };
