import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const FORMAT_PREFIX = "scrypt";

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

function costOptions(logN: number, r: number, p: number): ScryptOptions {
  const N = 2 ** logN;
  // scrypt needs ~128*N*r bytes; leave headroom so cost bumps do not fail mysteriously.
  return { N, r, p, maxmem: 128 * N * r * 2 + 1024 * 1024 };
}

const COMMON_PASSWORDS = new Set([
  "password1234",
  "123456789012",
  "qwertyuiop12",
  "administrator",
  "letmein12345",
  "welcome12345",
  "iloveyou1234",
  "changeme1234",
]);

export interface PasswordHasherOptions {
  /** log2 of the scrypt cost parameter N. 15 (N=32768) is the production default. */
  logN?: number;
  r?: number;
  p?: number;
}

/**
 * scrypt password hashing with a per-password random salt. The cost parameters are encoded
 * in the stored string (`scrypt$logN$r$p$salt$hash`), so verification always uses the
 * parameters the hash was created with and `needsRehash` can flag weaker legacy hashes.
 */
export class PasswordHasher {
  private readonly logN: number;
  private readonly r: number;
  private readonly p: number;

  constructor(options: PasswordHasherOptions = {}) {
    this.logN = options.logN ?? 15;
    this.r = options.r ?? 8;
    this.p = options.p ?? 1;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derived = await scryptAsync(password, salt, KEY_LENGTH, costOptions(this.logN, this.r, this.p));
    return [FORMAT_PREFIX, this.logN, this.r, this.p, salt.toString("base64"), derived.toString("base64")].join("$");
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== FORMAT_PREFIX) return false;
    const [, logN, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
    const expected = Buffer.from(hashB64, "base64");
    const salt = Buffer.from(saltB64, "base64");
    const derived = await scryptAsync(password, salt, expected.length, costOptions(Number(logN), Number(r), Number(p)));
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  needsRehash(stored: string): boolean {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== FORMAT_PREFIX) return true;
    return Number(parts[1]) < this.logN || Number(parts[2]) < this.r || Number(parts[3]) < this.p;
  }

  /** Burns the same work as a real verification so a login for an unknown email takes about
   *  as long as one for a real account (no user-enumeration timing signal). */
  async burn(password: string): Promise<void> {
    await scryptAsync(password, Buffer.alloc(SALT_LENGTH), KEY_LENGTH, costOptions(this.logN, this.r, this.p));
  }
}

/** Length over composition rules (NIST SP 800-63B direction). Returns human-readable problems. */
export function checkPasswordPolicy(password: string, context: { email?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push("must be at least 12 characters");
  if (password.length > 128) problems.push("must be at most 128 characters");
  if (new Set(password).size < 5) problems.push("must contain at least 5 distinct characters");
  if (COMMON_PASSWORDS.has(password.toLowerCase())) problems.push("is too common");
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) {
    problems.push("must not contain your email name");
  }
  return problems;
}
