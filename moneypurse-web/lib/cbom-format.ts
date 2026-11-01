import type { CbomMeta, ComparisonMetrics, Discrepancy, DiscrepancyType } from "./api/security-types";

/** "80.0%" for a 0..1 ratio, "n/a" when the denominator was zero (the API sends null). */
export function formatRatio(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined || Number.isNaN(ratio) ? "n/a" : `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Shown next to every comparison number. Completeness is a statement about a scoped, manually
 * prepared ground truth, never about all cryptography in the system.
 */
export const GROUND_TRUTH_CAVEATS: readonly string[] = [
  "Completeness is defined only against this scoped ground truth: it is the share of the ground-truth items the generated CBOM contains. It is not coverage of all cryptography in the system.",
  "The ground truth was prepared by an AI assistant by manual inspection, by the same agent that wrote the generator, and needs human review before it supports any research claim.",
  "Precision is structurally easy here: the generator only reports what its sources (usage register, public certificates, dependency manifests, handshake telemetry) give it, so false positives are unlikely by construction.",
];

export const DISCREPANCY_LABEL: Record<DiscrepancyType, string> = {
  missing: "Missing from the CBOM (false negative)",
  unexpected: "Not in the ground truth (false positive)",
  "provenance-mismatch": "Provenance differs (declared vs observed)",
  "attribute-mismatch": "Attribute differs",
  "location-gap": "Locations not found in the evidence",
};

const DISCREPANCY_ORDER: DiscrepancyType[] = ["missing", "unexpected", "provenance-mismatch", "attribute-mismatch", "location-gap"];

export interface DiscrepancyGroup {
  type: DiscrepancyType;
  label: string;
  items: Discrepancy[];
}

/** Non-empty groups in a fixed order, so the false negatives are always listed first. */
export function groupDiscrepancies(list: readonly Discrepancy[]): DiscrepancyGroup[] {
  return DISCREPANCY_ORDER.map((type) => ({ type, label: DISCREPANCY_LABEL[type], items: list.filter((d) => d.type === type) })).filter((g) => g.items.length > 0);
}

export interface MetricRow {
  label: string;
  value: string;
  detail: string;
}

export function metricRows(m: ComparisonMetrics): MetricRow[] {
  return [
    { label: "Ground-truth items", value: String(m.groundTruthItems), detail: "The scoped manual list this CBOM is compared with." },
    { label: "Generated assets", value: String(m.generatedAssets), detail: "Cryptographic assets in the generated CBOM (library components are out of scope)." },
    { label: "True positives", value: String(m.truePositives), detail: "Generated assets that match a ground-truth item." },
    { label: "False positives", value: String(m.falsePositives), detail: "Generated assets with no ground-truth item." },
    { label: "False negatives", value: String(m.falseNegatives), detail: "Ground-truth items the CBOM does not contain." },
    { label: "Completeness (scoped)", value: formatRatio(m.completeness), detail: m.denominators.completeness },
    { label: "Precision", value: formatRatio(m.precision), detail: m.denominators.precision },
    {
      label: "Provenance agreement",
      value: formatRatio(m.provenanceAgreement.ratio),
      detail: `${m.provenanceAgreement.agreeing} of ${m.provenanceAgreement.matched} matched assets carry the expected declared/observed provenance.`,
    },
    {
      label: "Location recall",
      value: formatRatio(m.locationRecall.ratio),
      detail: `${m.locationRecall.found} of ${m.locationRecall.groundTruthLocations} ground-truth locations appear in the BOM evidence.`,
    },
  ];
}

export interface SourceHighlights {
  refusedFiles: { path: string; reason: string }[];
  unverifiedLocations: { entry: string; path: string; check: string }[];
  telemetry: { lookbackHours: number | null; eventsInWindow: number | null; distinctTuples: number | null } | null;
  activeProfile: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Reads the free-form sourceSummary defensively: anything not in the expected shape is ignored. */
export function sourceHighlights(summary: CbomMeta["sourceSummary"]): SourceHighlights {
  const certs = isRecord(summary["certificates"]) ? summary["certificates"] : {};
  const declared = isRecord(summary["declaredRegister"]) ? summary["declaredRegister"] : {};
  const telemetry = isRecord(summary["telemetry"]) ? summary["telemetry"] : null;
  const profile = isRecord(summary["activeTlsProfile"]) ? summary["activeTlsProfile"] : null;

  const refusedRaw = Array.isArray(certs["refused"]) ? certs["refused"] : [];
  const unverifiedRaw = Array.isArray(declared["unverifiedLocations"]) ? declared["unverifiedLocations"] : [];
  return {
    refusedFiles: refusedRaw.filter(isRecord).map((r) => ({ path: String(r["path"] ?? ""), reason: String(r["reason"] ?? "") })),
    unverifiedLocations: unverifiedRaw.filter(isRecord).map((u) => ({ entry: String(u["entry"] ?? ""), path: String(u["path"] ?? ""), check: String(u["check"] ?? "") })),
    telemetry: telemetry
      ? { lookbackHours: num(telemetry["lookbackHours"]), eventsInWindow: num(telemetry["eventsInWindow"]), distinctTuples: num(telemetry["distinctTuples"]) }
      : null,
    activeProfile: profile && typeof profile["name"] === "string" ? profile["name"] : null,
  };
}

export const LOOKBACK_MIN = 1;
export const LOOKBACK_MAX = 720;

/** Parses the lookback-hours input; null unless it is a whole number from 1 to 720. */
export function parseLookbackHours(input: string): number | null {
  if (!/^\d{1,4}$/.test(input.trim())) return null;
  const n = Number(input.trim());
  return n >= LOOKBACK_MIN && n <= LOOKBACK_MAX ? n : null;
}
