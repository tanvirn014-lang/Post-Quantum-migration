import { createHash, randomBytes, webcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(webcrypto as never);

// Certificates in this prototype are deliberately CLASSICAL (ECDSA P-256 signatures). The
// proposal scopes post-quantum signatures and PKI out; hybrid key agreement protects the TLS
// key establishment only, never certificate authentication.
const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNING_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

export interface Identity {
  certPem: string;
  keyPem: string;
  /** SHA-256 of the DER certificate, lowercase hex without separators. */
  sha256: string;
  subject: string;
}

export interface CertificateAuthority extends Identity {
  cert: x509.X509Certificate;
  privateKey: webcrypto.CryptoKey;
}

function pem(label: string, der: ArrayBuffer): string {
  const b64 = Buffer.from(new Uint8Array(der)).toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

async function exportKeyPem(key: webcrypto.CryptoKey): Promise<string> {
  return pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", key));
}

function serial(): string {
  const bytes = randomBytes(16);
  bytes[0]! &= 0x7f; // keep it a positive ASN.1 integer
  return bytes.toString("hex");
}

export function fingerprintOfPem(certPem: string): string {
  return createHash("sha256").update(new Uint8Array(new x509.X509Certificate(certPem).rawData)).digest("hex");
}

async function generateKeys(): Promise<webcrypto.CryptoKeyPair> {
  return webcrypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
}

function validity(days: number) {
  return { notBefore: new Date(Date.now() - 5 * 60_000), notAfter: new Date(Date.now() + days * 86_400_000) };
}

function toIdentity(cert: x509.X509Certificate, keyPem: string): Identity {
  return {
    certPem: cert.toString("pem"),
    keyPem,
    sha256: createHash("sha256").update(new Uint8Array(cert.rawData)).digest("hex"),
    subject: cert.subject,
  };
}

export async function createCertificateAuthority(commonName = "PQ Banking Research Test CA", days = 365): Promise<CertificateAuthority> {
  const keys = await generateKeys();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: `CN=${commonName}`,
    ...validity(days),
    signingAlgorithm: SIGNING_ALGORITHM,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return { ...toIdentity(cert, await exportKeyPem(keys.privateKey)), cert, privateKey: keys.privateKey };
}

async function issue(
  ca: CertificateAuthority,
  commonName: string,
  days: number,
  usage: "serverAuth" | "clientAuth",
  subjectAltNames: x509.JsonGeneralName[] = [],
): Promise<Identity> {
  const keys = await generateKeys();
  const extensions: x509.Extension[] = [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
    new x509.ExtendedKeyUsageExtension([usage === "serverAuth" ? x509.ExtendedKeyUsage.serverAuth : x509.ExtendedKeyUsage.clientAuth]),
    await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    await x509.AuthorityKeyIdentifierExtension.create(ca.cert, false),
  ];
  if (subjectAltNames.length > 0) extensions.push(new x509.SubjectAlternativeNameExtension(subjectAltNames));
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: `CN=${commonName}`,
    issuer: ca.cert.subject,
    ...validity(days),
    signingAlgorithm: SIGNING_ALGORITHM,
    signingKey: ca.privateKey,
    publicKey: keys.publicKey,
    extensions,
  });
  return toIdentity(cert, await exportKeyPem(keys.privateKey));
}

export function issueServerCertificate(ca: CertificateAuthority, opts: { commonName: string; dnsNames: string[]; ipAddresses: string[]; days?: number }): Promise<Identity> {
  return issue(ca, opts.commonName, opts.days ?? 90, "serverAuth", [
    ...opts.dnsNames.map((value) => ({ type: "dns" as const, value })),
    ...opts.ipAddresses.map((value) => ({ type: "ip" as const, value })),
  ]);
}

export function issuePeerCertificate(ca: CertificateAuthority, opts: { commonName: string; days?: number }): Promise<Identity> {
  return issue(ca, opts.commonName, opts.days ?? 90, "clientAuth");
}

/** A self-signed client certificate that is NOT issued by the trusted CA (for negative tests). */
export async function createUntrustedCertificate(commonName: string): Promise<Identity> {
  const keys = await generateKeys();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: `CN=${commonName}`,
    ...validity(30),
    signingAlgorithm: SIGNING_ALGORITHM,
    keys,
    extensions: [new x509.BasicConstraintsExtension(false, undefined, true)],
  });
  return toIdentity(cert, await exportKeyPem(keys.privateKey));
}
