import { createHash } from "node:crypto";
import { canonicalJson } from "../audit/chain.js";
import { describeSignatureAlgorithm } from "./certificates.js";
import { assetKey, canonicalAssetId, type AssetKind } from "./normalize.js";
import type { CertificateScan, DeclaredRegister, LibraryDependency, UsageRegister } from "./sources.js";

export const GENERATOR_NAME = "pq-banking-cbom-generator";
export const GENERATOR_VERSION = "0.1.0";
export const SPEC_VERSION = "1.7";

export type Provenance = "declared" | "observed";

export interface ObservedInventory {
  lookbackHours: number;
  totalEvents: number;
  connections: { negotiatedGroup: string | null; cipher: string | null; tlsVersion: string | null; count: number }[];
  runtimes: { instanceId: string; node?: string; openssl?: string }[];
}

export interface BomInput {
  declared: DeclaredRegister;
  certificates: CertificateScan;
  libraries: { libraries: LibraryDependency[]; missing: string[] };
  profile: { name: string; groups: string[] };
  observed: ObservedInventory;
  now: Date;
  serialNumber: string;
}

type Json = Record<string, unknown>;

interface Asset {
  key: string;
  kind: AssetKind;
  bomRef: string;
  name: string;
  description: string | undefined;
  crypto: Json;
  provenance: Provenance;
  sources: Set<string>;
  locations: Set<string>;
  unverifiedLocations: Set<string>;
  observedConnections: number;
  extra: { name: string; value: string }[];
}

export interface GeneratedAssetView {
  key: string;
  kind: AssetKind;
  name: string;
  bomRef: string;
  provenance: Provenance;
  locations: string[];
  /** Algorithm attributes used when comparing against expected values. */
  attributes: Record<string, string>;
}

export interface BomResult {
  document: Json;
  assets: GeneratedAssetView[];
  contentSha256: string;
  counts: { assets: number; declared: number; observed: number; libraries: number };
}

// Definitions used when a TLS group or cipher suite is seen but the register has no entry for it.
type AlgorithmEntry = UsageRegister["algorithms"][number];
const BUILTIN: Record<string, Omit<AlgorithmEntry, "locations">> = {
  x25519: { name: "X25519", description: "Classical ECDH key agreement (RFC 7748).", primitive: "key-agree", algorithmFamily: "ECDH", ellipticCurve: "other/Curve25519", oid: "1.3.101.110", cryptoFunctions: ["keygen", "keyderive"], classicalSecurityLevel: 128, nistQuantumSecurityLevel: 0 },
  mlkem768: { name: "ML-KEM-768", description: "Post-quantum KEM (FIPS 203).", primitive: "kem", algorithmFamily: "ML-KEM", parameterSetIdentifier: "768", oid: "2.16.840.1.101.3.4.4.2", cryptoFunctions: ["keygen", "encapsulate", "decapsulate"], nistQuantumSecurityLevel: 3 },
  x25519mlkem768: { name: "X25519MLKEM768", description: "Hybrid X25519 + ML-KEM-768 key agreement group for TLS 1.3 (RFC 10024).", primitive: "kem", cryptoFunctions: ["keygen", "encapsulate", "decapsulate", "keyderive"] },
  aes256gcm: { name: "AES-256-GCM", description: "AEAD cipher protecting TLS 1.3 application data.", primitive: "ae", algorithmFamily: "AES", parameterSetIdentifier: "256", oid: "2.16.840.1.101.3.4.1.46", cryptoFunctions: ["encrypt", "decrypt", "tag"] },
  aes128gcm: { name: "AES-128-GCM", description: "AEAD cipher protecting TLS 1.3 application data.", primitive: "ae", algorithmFamily: "AES", parameterSetIdentifier: "128", oid: "2.16.840.1.101.3.4.1.6", cryptoFunctions: ["encrypt", "decrypt", "tag"] },
  chacha20poly1305: { name: "ChaCha20-Poly1305", description: "AEAD cipher protecting TLS 1.3 application data.", primitive: "ae", algorithmFamily: "ChaCha20", cryptoFunctions: ["encrypt", "decrypt", "tag"] },
  sha256: { name: "SHA-256", description: "SHA-2 hash function.", primitive: "hash", algorithmFamily: "SHA-2", parameterSetIdentifier: "256", oid: "2.16.840.1.101.3.4.2.1", cryptoFunctions: ["digest"] },
  sha384: { name: "SHA-384", description: "SHA-2 hash function (TLS 1.3 transcript and key schedule).", primitive: "hash", algorithmFamily: "SHA-2", parameterSetIdentifier: "384", oid: "2.16.840.1.101.3.4.2.2", cryptoFunctions: ["digest"] },
};

const TLS13_SUITES: Record<string, { identifiers: string[]; algorithms: string[] }> = {
  TLS_AES_256_GCM_SHA384: { identifiers: ["0x13", "0x02"], algorithms: ["aes256gcm", "sha384"] },
  TLS_AES_128_GCM_SHA256: { identifiers: ["0x13", "0x01"], algorithms: ["aes128gcm", "sha256"] },
  TLS_CHACHA20_POLY1305_SHA256: { identifiers: ["0x13", "0x03"], algorithms: ["chacha20poly1305", "sha256"] },
};

const HYBRID_COMPONENTS: Record<string, string[]> = { x25519mlkem768: ["x25519", "mlkem768"] };

const slug = (s: string) => canonicalAssetId("algorithm", s) || "unnamed";

function algorithmProperties(e: Omit<AlgorithmEntry, "locations">): Json {
  const props: Json = { primitive: e.primitive, cryptoFunctions: e.cryptoFunctions };
  if (e.algorithmFamily) props["algorithmFamily"] = e.algorithmFamily;
  if (e.parameterSetIdentifier) props["parameterSetIdentifier"] = e.parameterSetIdentifier;
  if (e.ellipticCurve) props["ellipticCurve"] = e.ellipticCurve;
  if (e.classicalSecurityLevel !== undefined) props["classicalSecurityLevel"] = e.classicalSecurityLevel;
  if (e.nistQuantumSecurityLevel !== undefined) props["nistQuantumSecurityLevel"] = e.nistQuantumSecurityLevel;
  return props;
}

class Inventory {
  readonly assets = new Map<string, Asset>();

  upsert(kind: AssetKind, name: string, provenance: Provenance, source: string, init: { description?: string; crypto: Json; bomRefSuffix?: string }): Asset {
    const key = assetKey(kind, name);
    const existing = this.assets.get(key);
    if (existing) {
      existing.sources.add(source);
      // Declared wins: an asset described by configuration stays "declared" even if also seen live.
      if (provenance === "declared") existing.provenance = "declared";
      if (!existing.description && init.description) existing.description = init.description;
      return existing;
    }
    const short = kind === "related-crypto-material" ? "material" : kind;
    const asset: Asset = {
      key,
      kind,
      bomRef: `crypto/${short}/${canonicalAssetId(kind, name)}${init.bomRefSuffix ? `-${init.bomRefSuffix}` : ""}`,
      name,
      description: init.description,
      crypto: init.crypto,
      provenance,
      sources: new Set([source]),
      locations: new Set(),
      unverifiedLocations: new Set(),
      observedConnections: 0,
      extra: [],
    };
    this.assets.set(key, asset);
    return asset;
  }

  algorithmFromBuiltin(canonical: string, provenance: Provenance, source: string): Asset | undefined {
    const def = BUILTIN[canonical];
    if (!def) return undefined;
    return this.upsert("algorithm", def.name, provenance, source, { description: def.description, crypto: { assetType: "algorithm", algorithmProperties: algorithmProperties(def), ...(def.oid ? { oid: def.oid } : {}) } });
  }
}

function addLocations(asset: Asset, locations: { path: string; check: string }[]): void {
  for (const l of locations) (l.check === "found" ? asset.locations : asset.unverifiedLocations).add(l.path);
}

function toComponent(a: Asset): Json {
  const properties: { name: string; value: string }[] = [
    { name: "pq:provenance", value: a.provenance },
    { name: "pq:sources", value: [...a.sources].sort().join("; ") },
    ...(a.observedConnections > 0 ? [{ name: "pq:observed-connections", value: String(a.observedConnections) }] : []),
    ...(a.unverifiedLocations.size > 0 ? [{ name: "pq:unverified-locations", value: [...a.unverifiedLocations].sort().join("; ") }] : []),
    ...a.extra,
  ];
  return {
    type: "cryptographic-asset",
    "bom-ref": a.bomRef,
    name: a.name,
    ...(a.description ? { description: a.description } : {}),
    cryptoProperties: a.crypto,
    ...(a.locations.size > 0 ? { evidence: { occurrences: [...a.locations].sort().map((location) => ({ location })) } } : {}),
    properties,
  };
}

function attributesOf(crypto: Json): Record<string, string> {
  const props = (crypto["algorithmProperties"] as Json | undefined) ?? {};
  const out: Record<string, string> = {};
  for (const name of ["primitive", "algorithmFamily", "parameterSetIdentifier", "ellipticCurve"]) if (props[name] !== undefined) out[name] = String(props[name]);
  return out;
}

const tlsVersionLabel = (v: string): string => v.replace(/^TLSv?/i, "");

export function buildBom(input: BomInput): BomResult {
  const inv = new Inventory();

  // 1. Declared: the hand-maintained usage register.
  for (const { entry, locations } of input.declared.algorithms) {
    const asset = inv.upsert("algorithm", entry.name, "declared", "declared-usage-register", {
      description: entry.description,
      crypto: { assetType: "algorithm", algorithmProperties: algorithmProperties(entry), ...(entry.oid ? { oid: entry.oid } : {}) },
    });
    addLocations(asset, locations);
  }
  for (const { entry, locations } of input.declared.materials) {
    const asset = inv.upsert("related-crypto-material", entry.name, "declared", "declared-usage-register", {
      description: `${entry.description} Declared only: no key or secret value is read, stored or shown.`,
      crypto: { assetType: "related-crypto-material", relatedCryptoMaterialProperties: { type: entry.type, ...(entry.format ? { format: entry.format } : {}) } },
    });
    addLocations(asset, locations);
  }

  // 2. Declared: certificates (public files only).
  for (const { path: file, certificate } of input.certificates.certificates) {
    const sig = describeSignatureAlgorithm(certificate);
    const sigAsset = inv.upsert("algorithm", sig.name, "declared", "certificate-files", {
      description: `Signature algorithm of certificate(s) in the research PKI (${sig.classical ? "classical" : "post-quantum"}).`,
      crypto: {
        assetType: "algorithm",
        algorithmProperties: {
          primitive: sig.primitive,
          cryptoFunctions: ["sign", "verify"],
          ...(sig.algorithmFamily ? { algorithmFamily: sig.algorithmFamily } : {}),
          ...(sig.ellipticCurve ? { ellipticCurve: sig.ellipticCurve } : {}),
          ...(sig.classical ? { nistQuantumSecurityLevel: 0 } : {}),
        },
        oid: sig.oid,
      },
    });
    sigAsset.locations.add(file);
    const cert = inv.upsert("certificate", `X.509 certificate CN=${certificate.commonName}`, "declared", "certificate-files", {
      description: `${certificate.selfSigned ? "Self-signed" : "CA-issued"} X.509 certificate. Authentication uses a classical signature (${sig.name}); it is not post-quantum.`,
      bomRefSuffix: certificate.sha256.slice(0, 8),
      crypto: {
        assetType: "certificate",
        certificateProperties: {
          subjectName: certificate.subject,
          issuerName: certificate.issuer,
          notValidBefore: certificate.notValidBefore,
          notValidAfter: certificate.notValidAfter,
          serialNumber: certificate.serialNumber,
          signatureAlgorithmRef: sigAsset.bomRef,
          certificateFormat: "X.509",
          fingerprint: { alg: "SHA-256", content: certificate.sha256 },
        },
      },
    });
    cert.locations.add(file);
  }

  // 3. Declared: the active TLS profile's key-agreement groups.
  for (const group of input.profile.groups) {
    const canonical = canonicalAssetId("algorithm", group);
    const fromBuiltin = inv.algorithmFromBuiltin(canonical, "declared", `tls-profile:${input.profile.name}`);
    const asset =
      fromBuiltin ??
      inv.upsert("algorithm", group, "declared", `tls-profile:${input.profile.name}`, {
        description: "Key-agreement group named in the active TLS profile; no further metadata is known for it.",
        crypto: { assetType: "algorithm", algorithmProperties: { primitive: "key-agree", cryptoFunctions: ["keyderive"] } },
      });
    asset.sources.add(`tls-profile:${input.profile.name}`);
    for (const part of HYBRID_COMPONENTS[canonical] ?? []) inv.algorithmFromBuiltin(part, "declared", `tls-profile:${input.profile.name}`);
  }

  // 4. Protocol: TLS 1.3 is the sidecar's only accepted version; groups from the active profile.
  const tls = inv.upsert("protocol", "TLS 1.3", "declared", `tls-profile:${input.profile.name}`, {
    description: "TLS 1.3 key establishment between peers and the sidecar. Hybrid protection applies only to connections that negotiate a hybrid group.",
    crypto: { assetType: "protocol", protocolProperties: { type: "tls", version: "1.3", cipherSuites: [] } },
  });
  const registerProtocol = input.declared.protocols.find((p) => canonicalAssetId("protocol", p.entry.name) === canonicalAssetId("protocol", "TLS 1.3"));
  if (registerProtocol) {
    tls.sources.add("declared-usage-register");
    addLocations(tls, registerProtocol.locations);
  }

  // 5. Observed: negotiated groups, cipher suites, versions from live telemetry.
  const suites = new Map<string, { count: number; groups: Set<string> }>();
  for (const c of input.observed.connections) {
    if (c.negotiatedGroup) {
      const canonical = canonicalAssetId("algorithm", c.negotiatedGroup);
      const asset =
        inv.algorithmFromBuiltin(canonical, "observed", "connection-telemetry") ??
        inv.upsert("algorithm", c.negotiatedGroup, "observed", "connection-telemetry", {
          description: "Key-agreement group observed on live connections.",
          crypto: { assetType: "algorithm", algorithmProperties: { primitive: "key-agree", cryptoFunctions: ["keyderive"] } },
        });
      asset.sources.add("connection-telemetry");
      asset.observedConnections += c.count;
    }
    if (c.cipher) {
      const entry = suites.get(c.cipher) ?? { count: 0, groups: new Set<string>() };
      entry.count += c.count;
      if (c.negotiatedGroup) entry.groups.add(c.negotiatedGroup);
      suites.set(c.cipher, entry);
      for (const part of TLS13_SUITES[c.cipher]?.algorithms ?? []) {
        const a = inv.algorithmFromBuiltin(part, "observed", "connection-telemetry");
        if (a) {
          a.sources.add("connection-telemetry");
          a.observedConnections += c.count;
        }
      }
    }
    if (c.tlsVersion && tlsVersionLabel(c.tlsVersion) !== "1.3") {
      const odd = inv.upsert("protocol", `TLS ${tlsVersionLabel(c.tlsVersion)}`, "observed", "connection-telemetry", {
        description: "A TLS version other than 1.3 was observed. The sidecar is configured for TLS 1.3 only, so this needs investigation.",
        crypto: { assetType: "protocol", protocolProperties: { type: "tls", version: tlsVersionLabel(c.tlsVersion) } },
      });
      odd.observedConnections += c.count;
    } else if (c.tlsVersion) {
      tls.sources.add("connection-telemetry");
      tls.observedConnections += c.count;
    }
  }
  const suiteList = [...suites.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, s]) => {
    const known = TLS13_SUITES[name];
    return {
      name,
      ...(known ? { identifiers: known.identifiers, algorithms: known.algorithms.map((c) => inv.assets.get(assetKey("algorithm", BUILTIN[c]!.name))!.bomRef) } : {}),
      tlsGroups: [...s.groups].sort(),
    };
  });
  (tls.crypto["protocolProperties"] as Json)["cipherSuites"] = suiteList;
  (tls.crypto["protocolProperties"] as Json)["version"] = "1.3";
  tls.extra.push({ name: "pq:active-profile", value: `${input.profile.name} (${input.profile.groups.join(", ")})` });

  // 6. Assemble.
  const assets = [...inv.assets.values()].sort((a, b) => a.bomRef.localeCompare(b.bomRef));
  const cryptoComponents = assets.map(toComponent);

  const libraryComponents: Json[] = input.libraries.libraries.map((l) => ({
    type: "library",
    "bom-ref": `lib/${slug(l.name)}/${slug(l.manifest)}`,
    name: l.name,
    version: l.versionRange,
    description: `Cryptography-relevant dependency (${l.role}). Version is the range declared in ${l.manifest}, not a resolved version.`,
    properties: [
      { name: "pq:provenance", value: "declared" },
      { name: "pq:sources", value: l.manifest },
      { name: "pq:crypto-role", value: l.role },
    ],
  }));
  for (const rt of input.observed.runtimes) {
    if (rt.openssl) {
      libraryComponents.push({
        type: "library",
        "bom-ref": `runtime/openssl/${slug(rt.instanceId)}`,
        name: "OpenSSL",
        version: rt.openssl,
        description: "TLS library used by the sidecar's Node.js runtime, as reported by the running sidecar.",
        properties: [{ name: "pq:provenance", value: "observed" }, { name: "pq:sources", value: `sidecar-heartbeat:${rt.instanceId}` }],
      });
    }
    if (rt.node) {
      libraryComponents.push({
        type: "platform",
        "bom-ref": `runtime/nodejs/${slug(rt.instanceId)}`,
        name: "Node.js",
        version: rt.node,
        properties: [{ name: "pq:provenance", value: "observed" }, { name: "pq:sources", value: `sidecar-heartbeat:${rt.instanceId}` }],
      });
    }
  }
  libraryComponents.sort((a, b) => String(a["bom-ref"]).localeCompare(String(b["bom-ref"])));

  const observedCount = assets.filter((a) => a.provenance === "observed").length;
  const document: Json = {
    $schema: "http://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: SPEC_VERSION,
    serialNumber: input.serialNumber,
    version: 1,
    metadata: {
      timestamp: input.now.toISOString(),
      tools: { components: [{ type: "application", name: GENERATOR_NAME, version: GENERATOR_VERSION }] },
      component: {
        type: "application",
        "bom-ref": "pq-banking-prototype",
        name: "Hybrid post-quantum migration prototype (research)",
        description: "Research prototype; not a production banking system and not affiliated with any bank.",
      },
      properties: [
        { name: "pq:inventory-scope", value: "Scoped inventory of the prototype's own services (ledger-service, security-service, pqc-sidecar) and its research PKI, built from: the hand-maintained declared-usage register; public certificate files; dependency manifests via an explicit allow-list; the active TLS profile; and runtime telemetry from the lookback window." },
        { name: "pq:not-full-discovery", value: "true" },
        { name: "pq:limitations", value: "Declared sources can miss hard-coded, dynamic or unreachable cryptographic use. Observed data covers only connections seen in the lookback window. No source-code analysis is performed. This is not a complete cryptographic discovery of any system." },
        { name: "pq:authentication", value: "classical: certificate and token signatures in this inventory are ECDSA/EdDSA; the prototype has no post-quantum authentication." },
        { name: "pq:lookback-hours", value: String(input.observed.lookbackHours) },
        { name: "pq:observed-events-in-window", value: String(input.observed.totalEvents) },
        { name: "pq:active-tls-profile", value: input.profile.name },
        { name: "pq:generator", value: `${GENERATOR_NAME} ${GENERATOR_VERSION}` },
      ],
    },
    components: [...cryptoComponents, ...libraryComponents],
  };

  return {
    document,
    assets: assets.map((a) => ({ key: a.key, kind: a.kind, name: a.name, bomRef: a.bomRef, provenance: a.provenance, locations: [...a.locations].sort(), attributes: attributesOf(a.crypto) })),
    contentSha256: contentHash(document),
    counts: { assets: assets.length, declared: assets.length - observedCount, observed: observedCount, libraries: libraryComponents.length },
  };
}

/** SHA-256 of the canonical document without its volatile fields: same inputs, same hash. */
export function contentHash(document: Json): string {
  const { serialNumber: _serial, ...rest } = document;
  const metadata = { ...(rest["metadata"] as Json) };
  delete metadata["timestamp"];
  return createHash("sha256").update(canonicalJson({ ...rest, metadata })).digest("hex");
}

/** Reads the crypto assets back out of a stored document (used for comparison). */
export function viewAssets(document: Json): GeneratedAssetView[] {
  const components = (document["components"] as Json[] | undefined) ?? [];
  return components
    .filter((c) => c["type"] === "cryptographic-asset")
    .map((c) => {
      const crypto = c["cryptoProperties"] as Json;
      const kind = crypto["assetType"] as AssetKind;
      const props = (c["properties"] as { name: string; value: string }[] | undefined) ?? [];
      const occurrences = ((c["evidence"] as Json | undefined)?.["occurrences"] as { location: string }[] | undefined) ?? [];
      return {
        key: assetKey(kind, String(c["name"])),
        kind,
        name: String(c["name"]),
        bomRef: String(c["bom-ref"]),
        provenance: (props.find((p) => p.name === "pq:provenance")?.value as Provenance) ?? "declared",
        locations: occurrences.map((o) => o.location).sort(),
        attributes: attributesOf(crypto),
      };
    });
}
