import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { ROLES, type Role } from "../src/auth/permissions.js";
import { describeSignatureAlgorithm, parseCertificatePem } from "../src/cbom/certificates.js";
import { compareToGroundTruth, groundTruthInputSchema, type GroundTruthItem } from "../src/cbom/compare.js";
import { buildBom, contentHash, viewAssets, type BomInput, type GeneratedAssetView, type ObservedInventory } from "../src/cbom/generator.js";
import { assetKey, canonicalAssetId, normalizeToken } from "../src/cbom/normalize.js";
import { defaultSourceOptions, looksLikePrivateKeyPath, readUsageRegister, scanCertificates, scanManifests, type CbomSourceOptions } from "../src/cbom/sources.js";
import { SCHEMA_FILES, schemaHashes, validateBom } from "../src/cbom/validate.js";
import { FINGERPRINT_A, createTestApp, resetDatabase, setupPool, type TestApp } from "./helpers/test-app.js";

// dist/tests/cbom.test.js -> package root is two levels up, repository root three.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..");
const FIXTURE_PKI = "security-service/tests/fixtures/pki";
const GROUND_TRUTH_FILE = path.join(PACKAGE_ROOT, "ground-truth", "cbom-ground-truth.json");

/** Real register and manifests, but only the public fixture certificates (no dependency on a local research PKI). */
const fixtureSources = (): CbomSourceOptions => ({ ...defaultSourceOptions(), repoRoot: REPO_ROOT, certificatePatterns: [`${FIXTURE_PKI}/ca.pem`, `${FIXTURE_PKI}/peer.pem`, `${FIXTURE_PKI}/ed25519.pem`] });

const NO_TELEMETRY: ObservedInventory = { lookbackHours: 24, totalEvents: 0, connections: [], runtimes: [] };

async function bomInput(observed: ObservedInventory = NO_TELEMETRY, opts = fixtureSources()): Promise<BomInput> {
  return {
    declared: await readUsageRegister(opts),
    certificates: await scanCertificates(opts),
    libraries: await scanManifests(opts),
    profile: { name: "hybrid-preferred", groups: ["X25519MLKEM768", "X25519"] },
    observed,
    now: new Date("2026-11-01T00:00:00Z"),
    serialNumber: `urn:uuid:${randomUUID()}`,
  };
}

type Component = { name: string; type: string; properties?: { name: string; value: string }[]; cryptoProperties?: { assetType: string; certificateProperties?: Record<string, unknown> }; evidence?: { occurrences: { location: string }[] } };
const cryptoComponents = (doc: Record<string, unknown>): Component[] => (doc["components"] as Component[]).filter((c) => c.type === "cryptographic-asset");
const prop = (c: { properties?: { name: string; value: string }[] }, name: string) => c.properties?.find((p) => p.name === name)?.value;

describe("CBOM generator: document validity", () => {
  it("produces a CycloneDX 1.7 document that validates against the vendored official schema", async () => {
    const { document } = buildBom(await bomInput());
    assert.strictEqual(document["bomFormat"], "CycloneDX");
    assert.strictEqual(document["specVersion"], "1.7");
    const result = validateBom(document);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.valid, true);
    assert.ok(cryptoComponents(document).length > 10);
  });

  it("rejects a corrupted document (the validator is not a rubber stamp)", async () => {
    const { document } = buildBom(await bomInput());
    const corrupted = structuredClone(document) as { components: Component[]; specVersion: string };
    corrupted.components.find((c) => c.type === "cryptographic-asset")!.cryptoProperties!.assetType = "not-an-asset-type";
    assert.strictEqual(validateBom(corrupted).valid, false);
    const noFormat = { ...structuredClone(document), bomFormat: "SPDX" };
    assert.strictEqual(validateBom(noFormat).valid, false);
    const wrongComponentType = structuredClone(document) as { components: { type: string }[] };
    wrongComponentType.components[0]!.type = "gadget";
    assert.strictEqual(validateBom(wrongComponentType).valid, false);
  });

  it("vendored schema files match the hashes recorded in MANIFEST.md", () => {
    const manifest = readFileSync(path.join(PACKAGE_ROOT, "schemas", "cyclonedx-1.7", "MANIFEST.md"), "utf8");
    const hashes = schemaHashes();
    for (const file of SCHEMA_FILES) {
      assert.ok(manifest.includes(file), `${file} missing from MANIFEST.md`);
      assert.ok(manifest.includes(hashes[file]!), `${file}: recorded SHA-256 does not match the file on disk`);
    }
  });

  it("is reproducible: the same sources give the same content hash, independent of serial number and timestamp", async () => {
    const a = buildBom(await bomInput());
    const second = await bomInput();
    const b = buildBom({ ...second, now: new Date("2027-01-01T00:00:00Z") });
    assert.notStrictEqual(a.document["serialNumber"], b.document["serialNumber"]);
    assert.strictEqual(a.contentSha256, b.contentSha256);
    assert.strictEqual(contentHash(a.document), a.contentSha256);
    // ... and it changes when the content changes.
    const changed = buildBom({ ...second, profile: { name: "classical-only", groups: ["X25519"] } });
    assert.notStrictEqual(changed.contentSha256, a.contentSha256);
  });
});

describe("CBOM generator: provenance, scope and honesty", () => {
  it("tags every cryptographic asset declared or observed and lists evidence locations for declared ones", async () => {
    const { document } = buildBom(await bomInput());
    for (const c of cryptoComponents(document)) {
      const provenance = prop(c, "pq:provenance");
      assert.ok(provenance === "declared" || provenance === "observed", `${c.name}: ${provenance}`);
      if (provenance === "declared") assert.ok((c.evidence?.occurrences.length ?? 0) > 0, `${c.name} has no evidence occurrences`);
    }
  });

  it("states the scope and that it is not a full cryptographic discovery", async () => {
    const { document } = buildBom(await bomInput());
    const metadata = document["metadata"] as { properties: { name: string; value: string }[] };
    assert.strictEqual(prop(metadata, "pq:not-full-discovery"), "true");
    assert.match(prop(metadata, "pq:inventory-scope") ?? "", /Scoped inventory/);
    assert.match(prop(metadata, "pq:limitations") ?? "", /not a complete cryptographic discovery/);
    assert.match(prop(metadata, "pq:authentication") ?? "", /no post-quantum authentication/);
  });

  it("describes certificates as classical (ECDSA / EdDSA) and never makes quantum-safety claims", async () => {
    const { document } = buildBom(await bomInput());
    const certs = cryptoComponents(document).filter((c) => c.cryptoProperties?.assetType === "certificate");
    assert.deepStrictEqual(certs.map((c) => c.name).sort(), ["X.509 certificate CN=Fixture Test CA", "X.509 certificate CN=fixture-ed25519", "X.509 certificate CN=fixture-peer"]);
    const text = JSON.stringify(document);
    assert.match(text, /ECDSA-P-256-SHA256/);
    assert.match(text, /EdDSA-Ed25519/);
    assert.match(text, /it is not post-quantum/);
    assert.doesNotMatch(text, /quantum[- ](proof|safe|resistant)|fully secure|production-ready|compliant/i);
  });

  it("reports only declared assets when no telemetry exists, and adds observed ones from telemetry", async () => {
    const without = buildBom(await bomInput());
    assert.ok(!without.assets.some((a) => a.key === assetKey("algorithm", "AES-256-GCM")), "AES-256-GCM must not appear without observation");
    assert.ok(!without.assets.some((a) => a.provenance === "observed"));
    assert.strictEqual(without.counts.observed, 0);

    const telemetry: ObservedInventory = {
      lookbackHours: 24,
      totalEvents: 3,
      connections: [
        { negotiatedGroup: "X25519MLKEM768", cipher: "TLS_AES_256_GCM_SHA384", tlsVersion: "TLSv1.3", count: 2 },
        { negotiatedGroup: "X25519", cipher: "TLS_AES_256_GCM_SHA384", tlsVersion: "TLSv1.3", count: 1 },
      ],
      runtimes: [{ instanceId: "sidecar-test", node: "26.4.0", openssl: "3.5.7" }],
    };
    const withTelemetry = buildBom(await bomInput(telemetry));
    const byKey = new Map(withTelemetry.assets.map((a) => [a.key, a]));
    assert.strictEqual(byKey.get(assetKey("algorithm", "AES-256-GCM"))?.provenance, "observed");
    assert.strictEqual(byKey.get(assetKey("algorithm", "SHA-384"))?.provenance, "observed");
    // Asserted in code AND seen on the wire: stays declared (code is the stronger statement of intent) but records the observation.
    const hybrid = withTelemetry.document["components"] as Component[];
    assert.ok(hybrid.some((c) => c.name === "X25519MLKEM768" && Number(prop(c, "pq:observed-connections")) >= 2));
    assert.ok(hybrid.some((c) => /openssl/i.test(c.name) && prop(c, "pq:provenance") === "observed"));
    assert.strictEqual(validateBom(withTelemetry.document).valid, true);
  });

  it("flags register locations whose file or token has disappeared instead of silently trusting them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cbom-register-"));
    try {
      mkdirSync(path.join(dir, "reg"), { recursive: true });
      writeFileSync(path.join(dir, "src.ts"), "const hash = 'sha256';\n");
      writeFileSync(
        path.join(dir, "reg", "register.json"),
        JSON.stringify({
          schemaVersion: 1,
          description: "test",
          algorithms: [{ name: "SHA-256", description: "d", primitive: "hash", locations: [{ path: "src.ts", token: "sha256" }, { path: "src.ts", token: "nowhere-in-file" }, { path: "gone.ts", token: "x" }] }],
          protocols: [],
          materials: [],
        }),
      );
      const register = await readUsageRegister({ ...fixtureSources(), repoRoot: dir, usageRegister: "reg/register.json" });
      assert.deepStrictEqual(register.algorithms[0]!.locations.map((l) => l.check), ["found", "token-missing", "file-missing"]);
      const result = buildBom({ ...(await bomInput()), declared: register });
      const sha = result.document["components"] as Component[];
      assert.match(prop(sha.find((c) => c.name === "SHA-256")!, "pq:unverified-locations") ?? "", /src\.ts|gone\.ts/);
      assert.deepStrictEqual(result.assets.find((a) => a.name === "SHA-256")!.locations, ["src.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CBOM sources: private key safety", () => {
  const SENTINEL = "SENTINEL-PRIVATE-KEY-BODY-DO-NOT-LEAK";
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cbom-keys-"));
    const pki = path.join(dir, "pki");
    mkdirSync(path.join(pki, "peers", "a"), { recursive: true });
    copyFileSync(path.join(PACKAGE_ROOT, "tests", "fixtures", "pki", "ca.pem"), path.join(pki, "ca.pem"));
    // A "certificate" file that also carries a private key block must be discarded unread.
    const cert = readFileSync(path.join(PACKAGE_ROOT, "tests", "fixtures", "pki", "peer.pem"), "utf8");
    writeFileSync(path.join(pki, "peers", "a", "cert.pem"), `${cert}\n-----BEGIN PRIVATE KEY-----\n${SENTINEL}\n-----END PRIVATE KEY-----\n`);
    // A key-looking path must be refused without being opened.
    writeFileSync(path.join(pki, "ca.key.pem"), `-----BEGIN PRIVATE KEY-----\n${SENTINEL}\n-----END PRIVATE KEY-----\n`);
    writeFileSync(path.join(pki, "server.key"), SENTINEL);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const options = (patterns: string[]): CbomSourceOptions => ({ ...fixtureSources(), repoRoot: dir, certificatePatterns: patterns });

  it("recognises key-like file names", () => {
    for (const p of ["pki/ca.key.pem", "a/server.key", "x/id_rsa", "x/id_ed25519.pub", "k.p12", "k.pfx", "k.jks", "keys.pem", "tls-key.pem"]) assert.ok(looksLikePrivateKeyPath(p), p);
    for (const p of ["pki/ca.pem", "pki/peers/a/cert.pem", "monkey.pem", "keystone.pem"]) assert.ok(!looksLikePrivateKeyPath(p), p);
  });

  it("refuses key-looking paths unread and discards certificate files that contain a private key block", async () => {
    const scan = await scanCertificates(options(["pki/ca.pem", "pki/ca.key.pem", "pki/server.key", "pki/peers/*/cert.pem"]));
    assert.deepStrictEqual(scan.certificates.map((c) => c.path), ["pki/ca.pem"]);
    const reasons = Object.fromEntries(scan.refused.map((r) => [r.path, r.reason]));
    assert.match(reasons["pki/ca.key.pem"]!, /not opened/);
    assert.match(reasons["pki/server.key"]!, /not opened/);
    assert.match(reasons["pki/peers/a/cert.pem"]!, /private key material/);
  });

  it("never lets key material reach the scan result, the BOM or its persisted summary", async () => {
    const opts = options(["pki/ca.pem", "pki/ca.key.pem", "pki/server.key", "pki/peers/*/cert.pem"]);
    const scan = await scanCertificates(opts);
    const result = buildBom({ ...(await bomInput()), certificates: scan });
    for (const text of [JSON.stringify(scan), JSON.stringify(result.document)]) {
      assert.ok(!text.includes(SENTINEL));
      assert.ok(!text.includes("PRIVATE KEY"));
    }
  });

  it("does not follow register locations into .secrets or key files", async () => {
    mkdirSync(path.join(dir, ".secrets"), { recursive: true });
    writeFileSync(path.join(dir, ".secrets", "token.txt"), "abc");
    mkdirSync(path.join(dir, "reg"), { recursive: true });
    writeFileSync(
      path.join(dir, "reg", "r.json"),
      JSON.stringify({ schemaVersion: 1, description: "t", algorithms: [], protocols: [], materials: [{ name: "Secret", type: "secret-key", description: "d", locations: [{ path: ".secrets/token.txt", token: "abc" }, { path: "pki/ca.key.pem", token: "PRIVATE" }] }] }),
    );
    const register = await readUsageRegister({ ...fixtureSources(), repoRoot: dir, usageRegister: "reg/r.json" });
    assert.deepStrictEqual(register.materials[0]!.locations.map((l) => l.check), ["file-missing", "file-missing"]);
  });

  it("only reports allow-listed crypto libraries from package manifests", async () => {
    const { libraries, missing } = await scanManifests(fixtureSources());
    assert.deepStrictEqual(missing, []);
    assert.ok(libraries.length > 0);
    for (const l of libraries) assert.ok(["jose", "@peculiar/x509"].includes(l.name), l.name);
  });
});

describe("CBOM certificate parsing", () => {
  const load = (f: string) => parseCertificatePem(readFileSync(path.join(PACKAGE_ROOT, "tests", "fixtures", "pki", f), "utf8"));

  it("identifies ECDSA P-256 / SHA-256 and Ed25519 signatures from the certificate itself", () => {
    const ca = describeSignatureAlgorithm(load("ca.pem"));
    assert.strictEqual(ca.name, "ECDSA-P-256-SHA256");
    assert.strictEqual(ca.ellipticCurve, "nist/P-256");
    assert.strictEqual(ca.oid, "1.2.840.10045.4.3.2");
    assert.strictEqual(ca.classical, true);
    const ed = describeSignatureAlgorithm(load("ed25519.pem"));
    assert.strictEqual(ed.name, "EdDSA-Ed25519");
    assert.strictEqual(ed.oid, "1.3.101.112");
  });

  it("reports an unknown signature OID as unrecognized instead of guessing", () => {
    const cert = { ...load("ca.pem"), signatureOid: "1.2.3.4.5" };
    assert.match(describeSignatureAlgorithm(cert).name, /Unrecognized signature algorithm \(OID 1\.2\.3\.4\.5\)/);
  });

  it("extracts subject, self-signed flag and fingerprint", () => {
    const ca = load("ca.pem");
    assert.strictEqual(ca.commonName, "Fixture Test CA");
    assert.strictEqual(ca.selfSigned, true);
    assert.match(ca.sha256, /^[0-9a-f]{64}$/);
    assert.strictEqual(load("peer.pem").selfSigned, false);
  });
});

describe("CBOM normalization", () => {
  it("treats spelling variants of the same algorithm as one asset", () => {
    const ids = ["ML-KEM-768", "ml_kem 768", "mlkem768", "FIPS 203 ML-KEM-768"].map((n) => canonicalAssetId("algorithm", n));
    assert.deepStrictEqual(new Set(ids), new Set(["mlkem768"]));
    assert.strictEqual(canonicalAssetId("algorithm", "Ed25519"), canonicalAssetId("algorithm", "EdDSA-Ed25519"));
    assert.strictEqual(canonicalAssetId("algorithm", "ECDSA with SHA-256 (P-256)"), "ecdsap256sha256");
  });

  it("does not merge genuinely different algorithms", () => {
    assert.notStrictEqual(canonicalAssetId("algorithm", "SHA-256"), canonicalAssetId("algorithm", "SHA-384"));
    assert.notStrictEqual(canonicalAssetId("algorithm", "X25519"), canonicalAssetId("algorithm", "X25519MLKEM768"));
    assert.notStrictEqual(assetKey("algorithm", "SHA-256"), assetKey("related-crypto-material", "SHA-256"));
  });

  it("keys certificates by common name, ignoring the descriptive prefix and other subject fields", () => {
    const a = canonicalAssetId("certificate", "X.509 certificate CN=hybrid-bank");
    assert.strictEqual(a, canonicalAssetId("certificate", "CN=Hybrid-Bank, O=Example"));
    assert.strictEqual(a, canonicalAssetId("certificate", "CN=hybrid_bank"));
    assert.notStrictEqual(a, canonicalAssetId("certificate", "CN=legacy-psp"));
  });

  it("normalizes protocol names and punctuation", () => {
    assert.strictEqual(canonicalAssetId("protocol", "TLS 1.3"), canonicalAssetId("protocol", "TLSv1.3"));
    assert.strictEqual(normalizeToken(" A-b_c.d (e) "), "abcde");
  });
});

describe("CBOM ground-truth comparison", () => {
  const view = (kind: GeneratedAssetView["kind"], name: string, provenance: "declared" | "observed", locations: string[] = [], attributes: Record<string, string> = {}): GeneratedAssetView => ({
    key: assetKey(kind, name),
    kind,
    name,
    bomRef: `ref/${name}`,
    provenance,
    locations,
    attributes,
  });
  const gt = (kind: GroundTruthItem["kind"], name: string, expectedProvenance: "declared" | "observed", extra: Partial<GroundTruthItem> = {}): GroundTruthItem => ({ id: name, kind, name, expectedProvenance, locations: [], ...extra });

  it("computes true/false positives and negatives with explicit denominators", () => {
    const generated = [view("algorithm", "SHA-256", "declared"), view("algorithm", "X25519", "declared"), view("algorithm", "Extra-Alg", "declared"), view("protocol", "TLS 1.3", "declared")];
    const truth = [gt("algorithm", "sha256", "declared"), gt("algorithm", "x25519", "declared"), gt("protocol", "TLSv1.3", "declared"), gt("algorithm", "scrypt", "declared"), gt("algorithm", "HMAC-SHA256", "declared")];
    const { metrics, discrepancies } = compareToGroundTruth(generated, truth);
    assert.strictEqual(metrics.truePositives, 3);
    assert.strictEqual(metrics.falsePositives, 1);
    assert.strictEqual(metrics.falseNegatives, 2);
    assert.strictEqual(metrics.completeness, 0.6); // 3 / 5
    assert.strictEqual(metrics.precision, 0.75); // 3 / 4
    assert.match(metrics.denominators.completeness, /3 \/ 5/);
    assert.match(metrics.denominators.precision, /3 \/ 4/);
    assert.deepStrictEqual(discrepancies.filter((d) => d.type === "missing").map((d) => d.name).sort(), ["HMAC-SHA256", "scrypt"]);
    assert.deepStrictEqual(discrepancies.filter((d) => d.type === "unexpected").map((d) => d.name), ["Extra-Alg"]);
    assert.deepStrictEqual(metrics.byKind["algorithm"], { groundTruth: 4, generated: 3, truePositives: 2, falsePositives: 1, falseNegatives: 2 });
  });

  it("reports provenance, attribute and location discrepancies for matched assets", () => {
    const generated = [view("algorithm", "SHA-384", "declared", ["a.ts"], { parameterSetIdentifier: "256" })];
    const truth = [gt("algorithm", "SHA-384", "observed", { locations: ["a.ts", "b.ts"], expected: { parameterSetIdentifier: "384" } })];
    const { metrics, discrepancies } = compareToGroundTruth(generated, truth);
    assert.deepStrictEqual(discrepancies.map((d) => d.type).sort(), ["attribute-mismatch", "location-gap", "provenance-mismatch"]);
    assert.strictEqual(metrics.provenanceAgreement.ratio, 0);
    assert.deepStrictEqual(metrics.locationRecall, { groundTruthLocations: 2, found: 1, ratio: 0.5 });
  });

  it("handles an empty generated BOM without inventing a precision", () => {
    const { metrics } = compareToGroundTruth([], [gt("algorithm", "SHA-256", "declared")]);
    assert.strictEqual(metrics.completeness, 0);
    assert.strictEqual(metrics.precision, null);
  });

  it("rejects ground truth with duplicate canonical assets or no items", () => {
    const base = { scope: "s", preparedBy: "p" };
    assert.strictEqual(groundTruthInputSchema.safeParse({ ...base, items: [] }).success, false);
    assert.strictEqual(groundTruthInputSchema.safeParse({ ...base, items: [gt("algorithm", "ML-KEM-768", "declared"), gt("algorithm", "mlkem768", "declared")] }).success, false);
    assert.strictEqual(groundTruthInputSchema.safeParse({ ...base, items: [gt("algorithm", "SHA-256", "declared")] }).success, true);
  });
});

describe("checked-in ground truth file", () => {
  const raw = JSON.parse(readFileSync(GROUND_TRUTH_FILE, "utf8")) as { scope: string; preparedBy: string; excluded: string[]; items: GroundTruthItem[] };

  it("parses, and states how it was prepared and that it needs human review", () => {
    const parsed = groundTruthInputSchema.safeParse({ scope: raw.scope, preparedBy: raw.preparedBy, items: raw.items });
    assert.strictEqual(parsed.success, true);
    assert.match(raw.preparedBy, /AI assistant/);
    assert.match(raw.preparedBy, /human reviewer must confirm/);
    assert.ok(raw.excluded.length > 0, "the scope must say what is excluded");
  });

  it("only lists locations that exist in the repository (research PKI files are checked only when present)", () => {
    for (const item of raw.items) {
      for (const location of item.locations) {
        if (location.includes(".secrets/")) continue; // generated locally by the PKI tool, not versioned
        assert.ok(existsSync(path.join(REPO_ROOT, location)), `${item.id}: ${location} does not exist`);
      }
    }
  });

  it("did not copy the register: the register covers a strict subset of the ground-truth locations", async () => {
    const register = await readUsageRegister(fixtureSources());
    const declared = new Set(
      [...register.algorithms, ...register.protocols, ...register.materials].flatMap((e) => e.locations.map((l) => l.path)),
    );
    const truthLocations = new Set(raw.items.flatMap((i) => i.locations));
    assert.ok([...truthLocations].some((l) => !declared.has(l)), "ground truth must contain locations the register does not know");
  });
});

describe("CBOM API", () => {
  let pool: pg.Pool;
  let t: TestApp;
  let admin: string;
  let auditor: string;

  before(async () => {
    pool = await setupPool();
  });
  beforeEach(async () => {
    await resetDatabase(pool);
    t = await createTestApp(pool, {}, { ...fixtureSources(), groundTruthFile: GROUND_TRUTH_FILE });
    admin = await t.token("security_admin");
    auditor = await t.token("auditor");
  });
  after(async () => {
    await pool.end();
  });

  const generate = (token = admin, payload: object = {}) => t.app.inject({ method: "POST", url: "/v1/cbom/generate", headers: t.bearer(token), payload });
  const ingest = (events: object[]) => t.app.inject({ method: "POST", url: "/internal/v1/events/connections", headers: t.sidecar, payload: { events } });
  const event = (overrides: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    correlationId: `corr-${randomUUID().slice(0, 8)}`,
    occurredAt: new Date().toISOString(),
    remoteAddr: "127.0.0.1",
    certSha256: FINGERPRINT_A,
    tlsVersion: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    offeredGroups: [{ code: 0x11ec, name: "X25519MLKEM768" }, { code: 0x1d, name: "X25519" }],
    negotiatedGroup: "X25519MLKEM768",
    negotiatedGroupCode: 0x11ec,
    keyExchange: "hybrid",
    clientKeyShareBytes: 1216,
    serverKeyShareBytes: 1120,
    decision: "allowed-hybrid",
    reason: "hybrid group negotiated",
    handshakeMs: 4.2,
    configVersion: 1,
    ...overrides,
  });

  it("generates, persists and downloads a schema-valid CycloneDX 1.7 document", async () => {
    const res = await generate();
    assert.strictEqual(res.statusCode, 201);
    const meta = res.json();
    assert.strictEqual(meta.specVersion, "1.7");
    assert.strictEqual(meta.validation.valid, true);
    assert.strictEqual(meta.assets.total, meta.assets.declared + meta.assets.observed);
    assert.match(meta.serialNumber, /^urn:uuid:/);
    assert.match(meta.contentSha256, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(meta.sourceSummary.certificates.refused, []);

    const download = await t.app.inject({ method: "GET", url: `/v1/cbom/${meta.id}/document`, headers: t.bearer(auditor) });
    assert.strictEqual(download.statusCode, 200);
    assert.match(String(download.headers["content-type"]), /application\/vnd\.cyclonedx\+json/);
    assert.match(String(download.headers["content-disposition"]), /attachment; filename="cbom-/);
    const document = JSON.parse(download.body) as Record<string, unknown>;
    assert.strictEqual(document["serialNumber"], meta.serialNumber);
    assert.strictEqual(contentHash(document), meta.contentSha256);
    assert.strictEqual(validateBom(document).valid, true);

    const list = (await t.app.inject({ method: "GET", url: "/v1/cbom", headers: t.bearer(auditor) })).json();
    assert.deepStrictEqual(list.map((d: { id: string }) => d.id), [meta.id]);
    const one = await t.app.inject({ method: "GET", url: `/v1/cbom/${meta.id}`, headers: t.bearer(auditor) });
    assert.strictEqual(one.json().contentSha256, meta.contentSha256);
  });

  it("produces the same content hash for two generations from unchanged sources", async () => {
    const a = (await generate()).json();
    const b = (await generate()).json();
    assert.notStrictEqual(a.id, b.id);
    assert.notStrictEqual(a.serialNumber, b.serialNumber);
    assert.strictEqual(a.contentSha256, b.contentSha256);
  });

  it("adds observed assets from ingested telemetry and ignores events outside the lookback window", async () => {
    const before = (await generate()).json();
    assert.strictEqual(before.assets.observed, 0);

    await ingest([event({ occurredAt: new Date(Date.now() - 5 * 3_600_000).toISOString() })]);
    const stale = (await generate(admin, { lookbackHours: 1 })).json();
    assert.strictEqual(stale.assets.observed, 0, "an event older than the window must not create observed assets");

    await ingest([event()]);
    const fresh = (await generate(admin, { lookbackHours: 1 })).json();
    assert.ok(fresh.assets.observed >= 2, `expected AES-256-GCM and SHA-384 as observed, got ${fresh.assets.observed}`);
    const document = (await t.app.inject({ method: "GET", url: `/v1/cbom/${fresh.id}/document`, headers: t.bearer(auditor) })).json();
    const observed = cryptoComponents(document).filter((c) => prop(c, "pq:provenance") === "observed").map((c) => c.name);
    assert.ok(observed.includes("AES-256-GCM"));
    assert.ok(observed.includes("SHA-384"));
    assert.strictEqual(fresh.validation.valid, true);
    assert.strictEqual(fresh.lookbackHours, 1);
  });

  it("validates the lookback window and the id format", async () => {
    assert.strictEqual((await generate(admin, { lookbackHours: 0 })).statusCode, 400);
    assert.strictEqual((await generate(admin, { lookbackHours: 100_000 })).statusCode, 400);
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/cbom/not-a-uuid", headers: t.bearer(auditor) })).statusCode, 400);
    assert.strictEqual((await t.app.inject({ method: "GET", url: `/v1/cbom/${randomUUID()}`, headers: t.bearer(auditor) })).statusCode, 404);
    assert.strictEqual((await t.app.inject({ method: "GET", url: `/v1/cbom/${randomUUID()}/comparison`, headers: t.bearer(auditor) })).statusCode, 404);
  });

  it("seeds ground truth version 1 from the checked-in file and keeps /ground-truth distinct from /:id", async () => {
    const res = await t.app.inject({ method: "GET", url: "/v1/cbom/ground-truth", headers: t.bearer(auditor) });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    const file = JSON.parse(readFileSync(GROUND_TRUTH_FILE, "utf8")) as { items: unknown[] };
    assert.strictEqual(body.version, 1);
    assert.strictEqual(body.itemCount, file.items.length);
    assert.strictEqual(body.items.length, file.items.length);
    assert.match(body.preparedBy, /human reviewer must confirm/);
    assert.match(body.scope, /Excluded from scope/);
  });

  it("versions the ground truth: a PUT adds version 2 and later comparisons use it, earlier ones keep theirs", async () => {
    const cbom = (await generate()).json();
    const first = (await t.app.inject({ method: "POST", url: `/v1/cbom/${cbom.id}/compare`, headers: t.bearer(admin) })).json();
    assert.strictEqual(first.groundTruthVersion, 1);

    const put = await t.app.inject({
      method: "PUT",
      url: "/v1/cbom/ground-truth",
      headers: t.bearer(admin),
      payload: {
        scope: "Reviewed scope",
        preparedBy: "Human reviewer",
        items: [
          { id: "a", kind: "algorithm", name: "SHA-256", expectedProvenance: "declared", locations: [] },
          { id: "b", kind: "algorithm", name: "Imaginary-Cipher", expectedProvenance: "declared", locations: [] },
        ],
      },
    });
    assert.strictEqual(put.statusCode, 200);
    assert.strictEqual(put.json().version, 2);
    assert.strictEqual(put.json().itemCount, 2);

    const second = (await t.app.inject({ method: "POST", url: `/v1/cbom/${cbom.id}/compare`, headers: t.bearer(admin) })).json();
    assert.strictEqual(second.groundTruthVersion, 2);
    assert.strictEqual(second.metrics.truePositives, 1);
    assert.strictEqual(second.metrics.falseNegatives, 1);
    assert.strictEqual(second.metrics.completeness, 0.5);
    assert.ok(second.discrepancies.some((d: { type: string; name: string }) => d.type === "missing" && d.name === "Imaginary-Cipher"));

    // The latest stored comparison is the newest; version 1 is still retrievable in the history table.
    const stored = (await t.app.inject({ method: "GET", url: `/v1/cbom/${cbom.id}/comparison`, headers: t.bearer(auditor) })).json();
    assert.strictEqual(stored.id, second.id);
    const { rows } = await pool.query("SELECT ground_truth_version FROM cbom_comparisons WHERE cbom_id = $1 ORDER BY created_at", [cbom.id]);
    assert.deepStrictEqual(rows.map((r) => Number(r.ground_truth_version)), [1, 2]);
  });

  it("rejects an invalid ground truth without creating a version", async () => {
    const bad = await t.app.inject({
      method: "PUT",
      url: "/v1/cbom/ground-truth",
      headers: t.bearer(admin),
      payload: { scope: "s", preparedBy: "p", items: [{ id: "a", kind: "algorithm", name: "SHA-256", expectedProvenance: "declared" }, { id: "b", kind: "algorithm", name: "sha256", expectedProvenance: "declared" }] },
    });
    assert.strictEqual(bad.statusCode, 400);
    const missing = await t.app.inject({ method: "PUT", url: "/v1/cbom/ground-truth", headers: t.bearer(admin), payload: { scope: "s" } });
    assert.strictEqual(missing.statusCode, 400);
    assert.strictEqual((await t.app.inject({ method: "GET", url: "/v1/cbom/ground-truth", headers: t.bearer(auditor) })).json().version, 1);
  });

  it("compares a generated CBOM against the checked-in ground truth with self-consistent metrics", async () => {
    const cbom = (await generate()).json();
    const res = await t.app.inject({ method: "POST", url: `/v1/cbom/${cbom.id}/compare`, headers: t.bearer(admin) });
    assert.strictEqual(res.statusCode, 201);
    const { metrics, discrepancies } = res.json();
    assert.strictEqual(metrics.truePositives + metrics.falseNegatives, metrics.groundTruthItems);
    assert.strictEqual(metrics.truePositives + metrics.falsePositives, metrics.generatedAssets);
    assert.strictEqual(metrics.completeness, Math.round((metrics.truePositives / metrics.groundTruthItems) * 10000) / 10000);
    assert.strictEqual(metrics.generatedAssets, cbom.assets.total);
    assert.ok(metrics.denominators.completeness.includes(`/ ${metrics.groundTruthItems}`));
    assert.strictEqual(discrepancies.filter((d: { type: string }) => d.type === "missing").length, metrics.falseNegatives);
    assert.strictEqual(discrepancies.filter((d: { type: string }) => d.type === "unexpected").length, metrics.falsePositives);
    // The declared register is deliberately narrower than a manual inspection, so the result must not be perfect.
    assert.ok(metrics.completeness < 1 || discrepancies.some((d: { type: string }) => d.type === "location-gap"), "a perfect score would mean the ground truth was copied from the register");
  });

  it("writes an audit event for generate, ground-truth change and comparison, and the chain still verifies", async () => {
    const cbom = (await generate()).json();
    await t.app.inject({
      method: "PUT",
      url: "/v1/cbom/ground-truth",
      headers: t.bearer(admin),
      payload: { scope: "s", preparedBy: "p", items: [{ id: "a", kind: "algorithm", name: "SHA-256", expectedProvenance: "declared", locations: [] }] },
    });
    await t.app.inject({ method: "POST", url: `/v1/cbom/${cbom.id}/compare`, headers: t.bearer(admin) });

    const { rows } = await pool.query("SELECT action, resource_type, resource_id, outcome, actor_role, details FROM audit_events WHERE action LIKE 'cbom.%' ORDER BY seq");
    assert.deepStrictEqual(rows.map((r) => r.action), ["cbom.generate", "cbom.ground_truth.put", "cbom.compare"]);
    assert.ok(rows.every((r) => r.actor_role === "security_admin" && r.outcome === "success"));
    assert.strictEqual(rows[0].resource_id, cbom.id);
    assert.strictEqual(rows[0].details.schemaValid, true);
    assert.strictEqual(rows[0].details.contentSha256, cbom.contentSha256);
    assert.strictEqual(rows[1].details.version, 2);
    assert.strictEqual(rows[2].details.groundTruthVersion, 2);
    // Documents must not be copied into the audit log.
    assert.ok(!JSON.stringify(rows).includes("cryptographic-asset"));
    const verify = (await t.app.inject({ method: "GET", url: "/v1/audit/verify", headers: t.bearer(auditor) })).json();
    assert.strictEqual(verify.valid, true);
  });

  it("records nothing when a request is refused", async () => {
    const res = await generate(auditor);
    assert.strictEqual(res.statusCode, 403);
    const { rows } = await pool.query("SELECT 1 FROM audit_events WHERE action LIKE 'cbom.%'");
    assert.strictEqual(rows.length, 0);
    const { rows: docs } = await pool.query("SELECT 1 FROM cbom_documents");
    assert.strictEqual(docs.length, 0);
  });

  describe("access control", () => {
    const readers: Role[] = ["security_admin", "auditor"];
    const writers: Role[] = ["security_admin"];

    it("allows only security_admin to generate, compare and change ground truth, and security_admin/auditor to read", async () => {
      const cbom = (await generate()).json();
      const putPayload = { scope: "s", preparedBy: "p", items: [{ id: "a", kind: "algorithm", name: "SHA-256", expectedProvenance: "declared", locations: [] }] };
      const routes: { method: "GET" | "POST" | "PUT"; url: string; allowed: Role[]; payload?: object }[] = [
        { method: "GET", url: "/v1/cbom", allowed: readers },
        { method: "GET", url: "/v1/cbom/ground-truth", allowed: readers },
        { method: "GET", url: `/v1/cbom/${cbom.id}`, allowed: readers },
        { method: "GET", url: `/v1/cbom/${cbom.id}/document`, allowed: readers },
        { method: "GET", url: `/v1/cbom/${cbom.id}/comparison`, allowed: readers }, // 404 (no comparison yet) still means the guard passed
        { method: "POST", url: "/v1/cbom/generate", allowed: writers, payload: {} },
        { method: "POST", url: `/v1/cbom/${cbom.id}/compare`, allowed: writers, payload: {} },
        { method: "PUT", url: "/v1/cbom/ground-truth", allowed: writers, payload: putPayload },
      ];
      for (const route of routes) {
        for (const role of ROLES) {
          const res = await t.app.inject({ method: route.method, url: route.url, headers: t.bearer(await t.token(role)), ...(route.payload ? { payload: route.payload } : {}) });
          const reached = res.statusCode !== 401 && res.statusCode !== 403;
          assert.strictEqual(reached, route.allowed.includes(role), `${route.method} ${route.url} as ${role} got ${res.statusCode}: ${res.body}`);
        }
        const anonymous = await t.app.inject({ method: route.method, url: route.url, ...(route.payload ? { payload: route.payload } : {}) });
        assert.strictEqual(anonymous.statusCode, 401, `${route.method} ${route.url} without a token`);
      }
    });
  });

  it("does not expose private key paths even when a stray key-like file is configured as a certificate source", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cbom-api-"));
    try {
      writeFileSync(path.join(dir, "leak.key"), "-----BEGIN PRIVATE KEY-----\nAPI-SENTINEL\n-----END PRIVATE KEY-----\n");
      const app = await createTestApp(pool, {}, { ...fixtureSources(), certificatePatterns: [path.join(dir, "leak.key").replace(/\\/g, "/")], groundTruthFile: GROUND_TRUTH_FILE });
      const res = await app.app.inject({ method: "POST", url: "/v1/cbom/generate", headers: app.bearer(await app.token("security_admin")), payload: {} });
      assert.strictEqual(res.statusCode, 201);
      const document = await app.app.inject({ method: "GET", url: `/v1/cbom/${res.json().id}/document`, headers: app.bearer(await app.token("auditor")) });
      assert.ok(!res.body.includes("API-SENTINEL") && !document.body.includes("API-SENTINEL"));
      const refused = res.json().sourceSummary.certificates.refused as { path: string; reason: string }[];
      assert.strictEqual(refused.length, 1);
      assert.match(refused[0]!.reason, /not opened/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hashes the stored document consistently with the reported content hash", async () => {
    const cbom = (await generate()).json();
    const { rows } = await pool.query<{ document: Record<string, unknown> }>("SELECT document FROM cbom_documents WHERE id = $1", [cbom.id]);
    assert.strictEqual(contentHash(rows[0]!.document), cbom.contentSha256);
    assert.strictEqual(viewAssets(rows[0]!.document).length, cbom.assets.total);
  });
});
