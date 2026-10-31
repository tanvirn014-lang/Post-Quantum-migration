import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseCertificatePem, type ParsedCertificate } from "./certificates.js";

// dist/src/cbom/sources.js -> repository root is four levels up.
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface CbomSourceOptions {
  /** Root the declared sources are resolved against. */
  repoRoot: string;
  /** Repo-relative paths, or `dir/*\/name` style single-star segments, of PUBLIC certificate PEM files. */
  certificatePatterns: string[];
  /** Repo-relative package.json files of the packages in scope. */
  packageManifests: string[];
  /** The declared-usage register (hand-maintained, repo-relative). */
  usageRegister: string;
}

export function defaultSourceOptions(env: NodeJS.ProcessEnv = process.env): CbomSourceOptions {
  return {
    repoRoot: env["CBOM_REPO_ROOT"] ? path.resolve(env["CBOM_REPO_ROOT"]) : DEFAULT_REPO_ROOT,
    certificatePatterns: env["CBOM_CERT_FILES"]
      ? env["CBOM_CERT_FILES"].split(",").map((p) => p.trim()).filter(Boolean)
      : ["pqc-sidecar/.secrets/pki/ca.pem", "pqc-sidecar/.secrets/pki/sidecar/server.pem", "pqc-sidecar/.secrets/pki/peers/*/cert.pem"],
    packageManifests: ["ledger-service/package.json", "security-service/package.json", "pqc-sidecar/package.json", "moneypurse-web/package.json"],
    usageRegister: "security-service/cbom-sources/declared-usage.json",
  };
}

// ---- declared usage register --------------------------------------------------------------

const locationSchema = z.object({ path: z.string().min(1), token: z.string().min(1) });
const algorithmEntry = z.object({
  name: z.string().min(1),
  description: z.string(),
  primitive: z.string(),
  algorithmFamily: z.string().optional(),
  parameterSetIdentifier: z.string().optional(),
  ellipticCurve: z.string().optional(),
  oid: z.string().optional(),
  cryptoFunctions: z.array(z.string()).default([]),
  classicalSecurityLevel: z.number().int().optional(),
  nistQuantumSecurityLevel: z.number().int().optional(),
  locations: z.array(locationSchema).default([]),
});
const protocolEntry = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: z.string(),
  version: z.string(),
  locations: z.array(locationSchema).default([]),
});
const materialEntry = z.object({
  name: z.string().min(1),
  type: z.string(),
  format: z.string().optional(),
  description: z.string(),
  locations: z.array(locationSchema).default([]),
});
export const usageRegisterSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  algorithms: z.array(algorithmEntry),
  protocols: z.array(protocolEntry),
  materials: z.array(materialEntry),
});
export type UsageRegister = z.infer<typeof usageRegisterSchema>;

export interface CheckedLocation {
  path: string;
  /** Whether the file exists and contains the declared token. Never reads private key files. */
  check: "found" | "token-missing" | "file-missing";
}

/** True for paths that look like private key material. Such files are never opened. */
export function looksLikePrivateKeyPath(p: string): boolean {
  const base = path.basename(p).toLowerCase();
  const tokens = base.split(/[._-]+/);
  return tokens.includes("key") || tokens.includes("keys") || /\.(p12|pfx|jks)$/.test(base) || base.startsWith("id_rsa") || base.startsWith("id_ed25519");
}

const SECRETS_DIR = /(^|[\\/])\.secrets([\\/]|$)/;

async function checkLocation(repoRoot: string, loc: { path: string; token: string }): Promise<CheckedLocation> {
  const full = path.resolve(repoRoot, loc.path);
  // Declared locations may point at env examples and source files, never at key files.
  if (looksLikePrivateKeyPath(loc.path) || SECRETS_DIR.test(loc.path) || !full.startsWith(repoRoot)) return { path: loc.path, check: "file-missing" };
  if (!existsSync(full)) return { path: loc.path, check: "file-missing" };
  const text = await readFile(full, "utf8");
  return { path: loc.path, check: text.includes(loc.token) ? "found" : "token-missing" };
}

export interface DeclaredRegister {
  register: UsageRegister;
  algorithms: { entry: UsageRegister["algorithms"][number]; locations: CheckedLocation[] }[];
  protocols: { entry: UsageRegister["protocols"][number]; locations: CheckedLocation[] }[];
  materials: { entry: UsageRegister["materials"][number]; locations: CheckedLocation[] }[];
}

export async function readUsageRegister(opts: CbomSourceOptions): Promise<DeclaredRegister> {
  const register = usageRegisterSchema.parse(JSON.parse(await readFile(path.resolve(opts.repoRoot, opts.usageRegister), "utf8")));
  const check = async <T extends { locations: { path: string; token: string }[] }>(entries: T[]) =>
    Promise.all(entries.map(async (entry) => ({ entry, locations: await Promise.all(entry.locations.map((l) => checkLocation(opts.repoRoot, l))) })));
  return { register, algorithms: await check(register.algorithms), protocols: await check(register.protocols), materials: await check(register.materials) };
}

// ---- certificates -------------------------------------------------------------------------

export interface CertificateSource {
  path: string;
  certificate: ParsedCertificate;
}

export interface RefusedFile {
  path: string;
  reason: string;
}

export interface CertificateScan {
  certificates: CertificateSource[];
  refused: RefusedFile[];
  /** Patterns that matched no file (a missing PKI is a finding, not an error). */
  unmatched: string[];
}

async function expandPattern(repoRoot: string, pattern: string): Promise<string[]> {
  if (!pattern.includes("*")) return [pattern];
  const segments = pattern.split("/");
  const starAt = segments.findIndex((s) => s.includes("*"));
  if (segments.slice(starAt + 1, -1).some((s) => s.includes("*")) || segments.slice(0, starAt).some((s) => s.includes("*")) || segments[starAt] !== "*") {
    return []; // only a single whole-segment `*` is supported
  }
  const dir = path.resolve(repoRoot, ...segments.slice(0, starAt));
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => [...segments.slice(0, starAt), e.name, ...segments.slice(starAt + 1)].join("/"));
}

/**
 * Reads PUBLIC certificates only. A path that looks like key material is refused WITHOUT being
 * opened; a file that is opened but contains a private key block is refused and discarded - its
 * content is never parsed into the inventory or retained.
 */
export async function scanCertificates(opts: CbomSourceOptions): Promise<CertificateScan> {
  const certificates: CertificateSource[] = [];
  const refused: RefusedFile[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const pattern of opts.certificatePatterns) {
    const expanded = await expandPattern(opts.repoRoot, pattern);
    const candidates = expanded.filter((p) => existsSync(path.resolve(opts.repoRoot, p)));
    if (candidates.length === 0) unmatched.push(pattern);
    for (const rel of candidates) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (looksLikePrivateKeyPath(rel)) {
        refused.push({ path: rel, reason: "path looks like private key material; not opened" });
        continue;
      }
      const text = await readFile(path.resolve(opts.repoRoot, rel), "utf8");
      if (/PRIVATE KEY/.test(text)) {
        refused.push({ path: rel, reason: "file contains private key material; discarded unread" });
        continue;
      }
      if (!text.includes("-----BEGIN CERTIFICATE-----")) {
        refused.push({ path: rel, reason: "not a certificate PEM" });
        continue;
      }
      try {
        certificates.push({ path: rel, certificate: parseCertificatePem(text) });
      } catch (err) {
        refused.push({ path: rel, reason: `unparseable certificate: ${(err as Error).message}` });
      }
    }
  }
  certificates.sort((a, b) => a.path.localeCompare(b.path));
  return { certificates, refused, unmatched };
}

// ---- dependency manifests -----------------------------------------------------------------

/** Explicit allow-list: only these libraries are reported, each with the cryptographic role it plays here. */
export const CRYPTO_LIBRARY_ALLOW_LIST: Record<string, string> = {
  jose: "JWT signing and verification (EdDSA / Ed25519)",
  "@peculiar/x509": "X.509 certificate generation for the research PKI (ECDSA P-256)",
};

export interface LibraryDependency {
  name: string;
  versionRange: string;
  role: string;
  manifest: string;
}

export async function scanManifests(opts: CbomSourceOptions): Promise<{ libraries: LibraryDependency[]; missing: string[] }> {
  const libraries: LibraryDependency[] = [];
  const missing: string[] = [];
  for (const rel of opts.packageManifests) {
    const full = path.resolve(opts.repoRoot, rel);
    if (!existsSync(full)) {
      missing.push(rel);
      continue;
    }
    const pkg = JSON.parse(await readFile(full, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const role = CRYPTO_LIBRARY_ALLOW_LIST[name];
      if (role) libraries.push({ name, versionRange: range, role, manifest: rel });
    }
  }
  libraries.sort((a, b) => a.name.localeCompare(b.name) || a.manifest.localeCompare(b.manifest));
  return { libraries, missing };
}
