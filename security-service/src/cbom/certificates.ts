import { X509Certificate, createHash } from "node:crypto";

export interface ParsedCertificate {
  subject: string;
  issuer: string;
  /** Common name of the subject, used for naming. */
  commonName: string;
  notValidBefore: string;
  notValidAfter: string;
  serialNumber: string;
  sha256: string;
  signatureOid: string;
  /** Public key algorithm as node reports it: 'ec', 'ed25519', 'rsa', ... */
  keyType: string;
  curve: string | undefined;
  selfSigned: boolean;
}

/** Reads one DER TLV header; returns the content offsets. */
function readTlv(buf: Buffer, offset: number): { tag: number; start: number; end: number } {
  const tag = buf[offset]!;
  let length = buf[offset + 1]!;
  let start = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 4) throw new Error("unsupported DER length");
    length = 0;
    for (let i = 0; i < bytes; i++) length = (length << 8) | buf[start + i]!;
    start += bytes;
  }
  return { tag, start, end: start + length };
}

function decodeOid(content: Buffer): string {
  const parts: number[] = [Math.floor(content[0]! / 40), content[0]! % 40];
  let value = 0;
  for (let i = 1; i < content.length; i++) {
    value = (value << 7) | (content[i]! & 0x7f);
    if (!(content[i]! & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

/**
 * Extracts the OUTER signatureAlgorithm OID of an X.509 certificate (the algorithm the issuer
 * signed with). node:crypto does not expose it, so the DER is walked directly:
 * Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }.
 */
export function signatureAlgorithmOid(der: Buffer): string {
  const cert = readTlv(der, 0);
  const tbs = readTlv(der, cert.start);
  const sigAlg = readTlv(der, tbs.end);
  const oid = readTlv(der, sigAlg.start);
  if (oid.tag !== 0x06) throw new Error("malformed certificate: signatureAlgorithm is not an OID");
  return decodeOid(der.subarray(oid.start, oid.end));
}

const CURVE_LABELS: Record<string, string> = { prime256v1: "P-256", secp256r1: "P-256", secp384r1: "P-384", secp521r1: "P-521" };

export function parseCertificatePem(pem: string): ParsedCertificate {
  const cert = new X509Certificate(pem);
  const details = cert.publicKey.asymmetricKeyDetails as { namedCurve?: string } | undefined;
  const cn = /CN=([^\n,]+)/.exec(cert.subject)?.[1]?.trim() ?? cert.subject.replace(/\n/g, ", ");
  return {
    subject: cert.subject.replace(/\n/g, ", "),
    issuer: cert.issuer.replace(/\n/g, ", "),
    commonName: cn,
    notValidBefore: new Date(cert.validFrom).toISOString(),
    notValidAfter: new Date(cert.validTo).toISOString(),
    serialNumber: cert.serialNumber,
    sha256: createHash("sha256").update(new Uint8Array(cert.raw)).digest("hex"),
    signatureOid: signatureAlgorithmOid(cert.raw),
    keyType: cert.publicKey.asymmetricKeyType ?? "unknown",
    curve: details?.namedCurve ? (CURVE_LABELS[details.namedCurve] ?? details.namedCurve) : undefined,
    selfSigned: cert.subject === cert.issuer,
  };
}

export interface SignatureAlgorithmInfo {
  name: string;
  primitive: "signature";
  algorithmFamily?: string;
  ellipticCurve?: string;
  oid: string;
  classical: boolean;
}

const HASH_BY_OID: Record<string, string> = {
  "1.2.840.10045.4.3.2": "SHA256",
  "1.2.840.10045.4.3.3": "SHA384",
  "1.2.840.10045.4.3.4": "SHA512",
};
const CURVE_ENUM: Record<string, string> = { "P-256": "nist/P-256", "P-384": "nist/P-384", "P-521": "nist/P-521" };

/** Names a certificate's signature algorithm; unknown OIDs are reported as such, never guessed. */
export function describeSignatureAlgorithm(cert: ParsedCertificate): SignatureAlgorithmInfo {
  const hash = HASH_BY_OID[cert.signatureOid];
  if (hash && cert.keyType === "ec") {
    const curve = cert.curve ?? "unknown-curve";
    return {
      name: `ECDSA-${curve}-${hash}`,
      primitive: "signature",
      algorithmFamily: "ECDSA",
      ...(CURVE_ENUM[curve] ? { ellipticCurve: CURVE_ENUM[curve] } : {}),
      oid: cert.signatureOid,
      classical: true,
    };
  }
  if (cert.signatureOid === "1.3.101.112") {
    return { name: "EdDSA-Ed25519", primitive: "signature", algorithmFamily: "EdDSA", ellipticCurve: "other/Ed25519", oid: cert.signatureOid, classical: true };
  }
  if (cert.signatureOid === "1.2.840.113549.1.1.11") {
    return { name: "RSASSA-PKCS1-v1_5-SHA256", primitive: "signature", algorithmFamily: "RSASSA-PKCS1", oid: cert.signatureOid, classical: true };
  }
  return { name: `Unrecognized signature algorithm (OID ${cert.signatureOid})`, primitive: "signature", oid: cert.signatureOid, classical: true };
}
