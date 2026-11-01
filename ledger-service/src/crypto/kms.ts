import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Key-management abstraction. The application never holds a long-lived data-encryption key: it asks
 * the KMS to envelope-encrypt a value (fresh random DEK per value, DEK wrapped by the master key)
 * and to decrypt it later. The port is what a real cloud KMS / HSM plugs into; `DevKms` is a
 * self-contained local backend for development and tests. Blobs are versioned by the master key
 * that wrapped them, so a master key can be rotated while old blobs stay readable.
 */
export interface KeyManagementService {
  /** Envelope-encrypts plaintext; returns a self-contained, versioned blob safe to store at rest. */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypts a blob from encrypt(); throws (fails closed) on tamper, wrong key, or unknown version. */
  decrypt(blob: string): Promise<string>;
}

const MAGIC = "kms1";
const b64 = (b: Buffer) => b.toString("base64url");
const ub64 = (s: string) => Buffer.from(s, "base64url");
const versionOf = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 16);

/** Local AES-256-GCM envelope KMS. In production this is replaced by a cloud-KMS/HSM adapter behind
 *  the same port; see docs/audits/11_STAGED_PLAN_M4_M9.md (M4.e). */
export class DevKms implements KeyManagementService {
  private readonly activeVersion: string;
  private readonly keysByVersion: Map<string, Buffer>;

  constructor(activeKey: Buffer, previousKeys: Buffer[] = []) {
    for (const k of [activeKey, ...previousKeys]) {
      if (k.length !== 32) throw new Error("KMS master key must be 32 bytes");
    }
    this.activeVersion = versionOf(activeKey);
    this.keysByVersion = new Map([[this.activeVersion, activeKey], ...previousKeys.map((k) => [versionOf(k), k] as const)]);
  }

  async encrypt(plaintext: string): Promise<string> {
    const activeKey = this.keysByVersion.get(this.activeVersion)!;
    const dek = randomBytes(32);
    // Encrypt the value with a fresh data key.
    const iv1 = randomBytes(12);
    const c1 = createCipheriv("aes-256-gcm", dek, iv1);
    const ct = Buffer.concat([c1.update(plaintext, "utf8"), c1.final()]);
    const tag1 = c1.getAuthTag();
    // Wrap the data key with the active master key.
    const iv2 = randomBytes(12);
    const c2 = createCipheriv("aes-256-gcm", activeKey, iv2);
    const wrapped = Buffer.concat([c2.update(dek), c2.final()]);
    const tag2 = c2.getAuthTag();
    return [MAGIC, this.activeVersion, b64(iv2), b64(wrapped), b64(tag2), b64(iv1), b64(ct), b64(tag1)].join(".");
  }

  async decrypt(blob: string): Promise<string> {
    const parts = blob.split(".");
    if (parts.length !== 8 || parts[0] !== MAGIC) throw new Error("KMS: malformed ciphertext");
    const [, version, iv2, wrapped, tag2, iv1, ct, tag1] = parts as [string, string, string, string, string, string, string, string];
    const masterKey = this.keysByVersion.get(version);
    if (!masterKey) throw new Error(`KMS: no key for version ${version}`);
    const d2 = createDecipheriv("aes-256-gcm", masterKey, ub64(iv2));
    d2.setAuthTag(ub64(tag2));
    const dek = Buffer.concat([d2.update(ub64(wrapped)), d2.final()]);
    const d1 = createDecipheriv("aes-256-gcm", dek, ub64(iv1));
    d1.setAuthTag(ub64(tag1));
    return Buffer.concat([d1.update(ub64(ct)), d1.final()]).toString("utf8");
  }
}

