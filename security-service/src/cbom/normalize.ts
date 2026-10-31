export type AssetKind = "algorithm" | "protocol" | "certificate" | "related-crypto-material";
export const ASSET_KINDS: readonly AssetKind[] = ["algorithm", "protocol", "certificate", "related-crypto-material"];

/** Lowercase and drop separators so "ML-KEM-768", "ml_kem 768" and "mlkem768" compare equal. */
export function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s\-_().,/:+]+/g, "");
}

// Normalized spelling -> canonical id. Only genuinely equivalent names belong here: an alias
// table that papers over real differences would hide discrepancies the comparison must show.
const ALGORITHM_ALIASES: Record<string, string> = {
  x25519: "x25519",
  curve25519: "x25519",
  ecdhx25519: "x25519",
  mlkem768: "mlkem768",
  fips203mlkem768: "mlkem768",
  x25519mlkem768: "x25519mlkem768",
  hybridx25519mlkem768: "x25519mlkem768",
  ed25519: "ed25519",
  eddsa: "ed25519",
  eddsaed25519: "ed25519",
  sha256: "sha256",
  sha2256: "sha256",
  sha384: "sha384",
  sha2384: "sha384",
  hmacsha256: "hmacsha256",
  hmacwithsha256: "hmacsha256",
  aes256gcm: "aes256gcm",
  aesgcm256: "aes256gcm",
  scrypt: "scrypt",
  ecdsap256sha256: "ecdsap256sha256",
  ecdsap256: "ecdsap256sha256",
  ecdsawithsha256: "ecdsap256sha256",
  ecdsap256withsha256: "ecdsap256sha256",
  ecdsasha256p256: "ecdsap256sha256",
  ecdsawithsha256p256: "ecdsap256sha256",
};

const PROTOCOL_ALIASES: Record<string, string> = { tls13: "tls13", tlsv13: "tls13" };

/** The identity two descriptions of the same asset share, independent of spelling. */
export function canonicalAssetId(kind: AssetKind, name: string): string {
  if (kind === "certificate") {
    const cn = /CN=([^,/]+)/i.exec(name)?.[1] ?? name;
    return normalizeToken(cn);
  }
  const normalized = normalizeToken(name);
  if (kind === "algorithm") return ALGORITHM_ALIASES[normalized] ?? normalized;
  if (kind === "protocol") return PROTOCOL_ALIASES[normalized] ?? normalized;
  return normalized;
}

export function assetKey(kind: AssetKind, name: string): string {
  return `${kind}:${canonicalAssetId(kind, name)}`;
}
