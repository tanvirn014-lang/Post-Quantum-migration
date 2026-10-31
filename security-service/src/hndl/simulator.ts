/**
 * Educational "harvest now, decrypt later" (HNDL) simulator.
 *
 * What is real: the key agreements (X25519 and ML-KEM-768 from node:crypto), the key derivation
 * (HKDF-SHA256) and the authenticated encryption (AES-256-GCM) are real primitives running on fresh
 * random keys, and the recorded sizes are the real wire sizes.
 *
 * What is modelled: the adversary. No quantum computer exists here and no real key is attacked.
 * "Recovering" a secret is an explicit assumption the caller chooses (`quantumAssumption`): the
 * simulator hands the adversary the private half of the key agreement the assumption declares broken,
 * and then lets real cryptography show what that does and does not unlock.
 */
import * as nodeCrypto from "node:crypto";
import { type KeyObject, createCipheriv, createDecipheriv, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

// ML-KEM is in Node's crypto since v24.7 / OpenSSL 3.5, but the pinned @types/node predates it.
interface MlKemApi {
  generateKeyPairSync(type: "ml-kem-768"): { publicKey: KeyObject; privateKey: KeyObject };
  encapsulate(publicKey: KeyObject): { sharedKey: Buffer; ciphertext: Buffer };
  decapsulate(privateKey: KeyObject, ciphertext: Buffer): Buffer;
}
const mlkem = nodeCrypto as unknown as MlKemApi;
const { encapsulate, decapsulate } = mlkem;

export type QuantumAssumption = "none" | "x25519-broken" | "both-broken";

export const QUANTUM_ASSUMPTIONS: readonly QuantumAssumption[] = ["none", "x25519-broken", "both-broken"];

export interface HndlInput {
  message: string;
  quantumAssumption: QuantumAssumption;
}

export interface CapturedSession {
  /** What a passive observer of the wire records. */
  capture: {
    clientKeyShareBytes: number;
    serverKeyShareBytes: number;
    ciphertextHex: string;
    ciphertextBytes: number;
  };
  recovered: boolean;
  recoveredPlaintext: string | null;
  reason: string;
}

export interface HndlRun {
  label: "SIMULATION";
  disclaimer: string;
  assumption: QuantumAssumption;
  assumptionExplained: string;
  sessions: { classical: CapturedSession; hybrid: CapturedSession };
  takeaways: string[];
  primitives: string[];
}

const MAX_MESSAGE_CHARS = 256;

const ASSUMPTION_TEXT: Record<QuantumAssumption, string> = {
  none: "No break is assumed: today's situation. Neither captured session can be opened by the adversary.",
  "x25519-broken":
    "Modelled assumption: a future quantum computer recovers the X25519 private key from its public key (Shor-type attack on elliptic curves). ML-KEM-768 is assumed to hold. This is an assumption, not something this program performs.",
  "both-broken":
    "Modelled assumption: both X25519 and ML-KEM-768 are broken. Included to show that the hybrid is only as strong as its stronger half, not unbreakable.",
};

const INFO = Buffer.from("hndl-simulator v1 session key", "utf8");

function deriveKey(secret: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(32), INFO, 32));
}

function seal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

function open(key: Buffer, sealed: Buffer): Buffer | null {
  try {
    const iv = sealed.subarray(0, 12);
    const tag = sealed.subarray(sealed.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
  } catch {
    return null; // GCM authentication failed: the key is wrong.
  }
}

interface X25519Pair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

const rawPublicLength = (key: KeyObject): number => key.export({ type: "spki", format: "der" }).length - 12; // SPKI header for X25519 is 12 bytes

/** X25519 key agreement between a fresh client and server pair; returns the secret and both shares. */
function x25519Agreement() {
  const client = generateKeyPairSync("x25519") as X25519Pair;
  const server = generateKeyPairSync("x25519") as X25519Pair;
  const secret = diffieHellman({ privateKey: client.privateKey, publicKey: server.publicKey });
  return { client, server, secret };
}

function classicalSession(plaintext: Buffer, assumption: QuantumAssumption) {
  const { client, server, secret } = x25519Agreement();
  const ciphertext = seal(deriveKey(secret), plaintext);

  // The adversary only has the captured public shares. Under an X25519 break it is given the client's
  // private key and recomputes the shared secret exactly as the server would.
  let recovered: Buffer | null = null;
  if (assumption !== "none") {
    const stolen = diffieHellman({ privateKey: client.privateKey, publicKey: server.publicKey });
    recovered = open(deriveKey(stolen), ciphertext);
  }
  const session: CapturedSession = {
    capture: {
      clientKeyShareBytes: rawPublicLength(client.publicKey),
      serverKeyShareBytes: rawPublicLength(server.publicKey),
      ciphertextHex: ciphertext.toString("hex"),
      ciphertextBytes: ciphertext.length,
    },
    recovered: recovered !== null,
    recoveredPlaintext: recovered ? recovered.toString("utf8") : null,
    reason:
      recovered !== null
        ? "The session key depends on X25519 alone, so recovering the X25519 secret recovers the session key and the recording opens."
        : "No break is assumed, so the recorded session stays closed.",
  };
  return session;
}

function hybridSession(plaintext: Buffer, assumption: QuantumAssumption) {
  const x = x25519Agreement();
  const kem = mlkem.generateKeyPairSync("ml-kem-768");
  const { sharedKey: kemSecret, ciphertext: kemCiphertext } = encapsulate(kem.publicKey);
  // X25519MLKEM768 concatenates the ML-KEM secret first, then the X25519 secret (RFC 10024 ordering).
  const secret = Buffer.concat([kemSecret, x.secret]);
  const ciphertext = seal(deriveKey(secret), plaintext);

  let recovered: Buffer | null = null;
  let reason = "No break is assumed, so the recorded session stays closed.";
  if (assumption === "x25519-broken") {
    // The adversary recovers the X25519 half only. It has no ML-KEM secret, so the best it can do is
    // derive a key from the X25519 half alone, and authenticated decryption rejects it.
    const stolen = diffieHellman({ privateKey: x.client.privateKey, publicKey: x.server.publicKey });
    recovered = open(deriveKey(Buffer.concat([Buffer.alloc(kemSecret.length), stolen])), ciphertext);
    reason =
      "The X25519 half was recovered but the session key also depends on the ML-KEM-768 secret, which the adversary does not have. The AES-GCM authentication check fails, so the recording stays closed.";
  } else if (assumption === "both-broken") {
    const stolenX = diffieHellman({ privateKey: x.client.privateKey, publicKey: x.server.publicKey });
    const stolenKem = decapsulate(kem.privateKey, kemCiphertext);
    recovered = open(deriveKey(Buffer.concat([stolenKem, stolenX])), ciphertext);
    reason = "Both halves were assumed recoverable, so the combined key is recomputed and the recording opens. The hybrid is not unbreakable; it is as strong as the stronger of its two halves.";
  }
  const session: CapturedSession = {
    capture: {
      // Client share = ML-KEM-768 public key (1184) + X25519 (32); server share = ML-KEM ciphertext (1088) + X25519 (32).
      clientKeyShareBytes: 1184 + rawPublicLength(x.client.publicKey),
      serverKeyShareBytes: kemCiphertext.length + rawPublicLength(x.server.publicKey),
      ciphertextHex: ciphertext.toString("hex"),
      ciphertextBytes: ciphertext.length,
    },
    recovered: recovered !== null,
    recoveredPlaintext: recovered ? recovered.toString("utf8") : null,
    reason,
  };
  return session;
}

export function runHndlSimulation(input: HndlInput): HndlRun {
  const message = input.message;
  if (typeof message !== "string" || message.length < 1 || message.length > MAX_MESSAGE_CHARS) {
    throw new RangeError(`message must be 1 to ${MAX_MESSAGE_CHARS} characters`);
  }
  if (!QUANTUM_ASSUMPTIONS.includes(input.quantumAssumption)) throw new RangeError("unknown quantumAssumption");
  const plaintext = Buffer.from(message, "utf8");

  return {
    label: "SIMULATION",
    disclaimer:
      "Educational simulation. It does not break any real key and runs no quantum algorithm: the adversary's capability is an assumption you choose, and the cryptography it then meets is real. Nothing here predicts when, or whether, such a computer will exist.",
    assumption: input.quantumAssumption,
    assumptionExplained: ASSUMPTION_TEXT[input.quantumAssumption],
    sessions: { classical: classicalSession(plaintext, input.quantumAssumption), hybrid: hybridSession(plaintext, input.quantumAssumption) },
    takeaways: [
      "Traffic recorded today can be decrypted later if its key agreement is broken later; the break need not exist when the traffic is recorded.",
      "A hybrid key agreement keeps recorded sessions closed unless both halves are broken.",
      "This protects key establishment on the connection only. It says nothing about certificates, stored data or other hops.",
    ],
    primitives: ["X25519 (node:crypto)", "ML-KEM-768 (node:crypto)", "HKDF-SHA256", "AES-256-GCM"],
  };
}

export interface MoscaInput {
  shelfLifeYears: number;
  migrationYears: number;
  yearsToQuantum: number;
}

export interface MoscaResult extends MoscaInput {
  atRisk: boolean;
  /** Years of recorded traffic that would still be sensitive when the assumed break arrives. */
  exposureYears: number;
  note: string;
}

function ensureYears(name: keyof MoscaInput, value: number, max: number): void {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new RangeError(`${name} must be a number between 0 and ${max}`);
}

/** Mosca's inequality: data is exposed to harvest-now-decrypt-later if shelf life X + migration time Y exceeds years to a relevant quantum computer Z. */
export function moscaAssessment(input: MoscaInput): MoscaResult {
  ensureYears("shelfLifeYears", input.shelfLifeYears, 100);
  ensureYears("migrationYears", input.migrationYears, 100);
  ensureYears("yearsToQuantum", input.yearsToQuantum, 100);
  const total = input.shelfLifeYears + input.migrationYears;
  return {
    ...input,
    atRisk: total > input.yearsToQuantum,
    exposureYears: Math.max(0, total - input.yearsToQuantum),
    note: "Years to a relevant quantum computer is your assumption, not a prediction; vary it to see how sensitive the conclusion is.",
  };
}
