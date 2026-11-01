import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DevKms } from "../../src/crypto/kms.js";

const key = () => randomBytes(32);

describe("DevKms envelope encryption", () => {
  it("round-trips a value and never stores it as plaintext", async () => {
    const kms = new DevKms(key());
    const blob = await kms.encrypt("alice@example.com");
    assert.notEqual(blob, "alice@example.com", "ciphertext is not the plaintext");
    assert.doesNotMatch(blob, /alice@example\.com/, "plaintext does not appear in the blob");
    assert.equal(await kms.decrypt(blob), "alice@example.com");
  });

  it("produces different ciphertext each time (fresh DEK and IV)", async () => {
    const kms = new DevKms(key());
    assert.notEqual(await kms.encrypt("same"), await kms.encrypt("same"));
  });

  it("fails closed when the ciphertext is tampered with", async () => {
    const kms = new DevKms(key());
    const blob = await kms.encrypt("secret");
    const tampered = blob.slice(0, -2) + (blob.endsWith("A") ? "B" : "A");
    await assert.rejects(() => kms.decrypt(tampered));
  });

  it("supports master-key rotation: a value encrypted under the old key still decrypts", async () => {
    const k1 = key();
    const k2 = key();
    const before = new DevKms(k1);
    const blob = await before.encrypt("pii");
    const afterRotation = new DevKms(k2, [k1]); // k2 active, k1 retained
    assert.equal(await afterRotation.decrypt(blob), "pii", "old blob still decrypts during the window");
    assert.equal(await afterRotation.decrypt(await afterRotation.encrypt("new")), "new", "new key works too");
  });

  it("fails closed once the old key is retired (rotation window closed)", async () => {
    const k1 = key();
    const k2 = key();
    const blob = await new DevKms(k1).encrypt("pii");
    const retired = new DevKms(k2); // k1 no longer available
    await assert.rejects(() => retired.decrypt(blob), /no key for version|unsupported state|bad/i);
  });

  it("rejects a master key that is not 32 bytes", () => {
    assert.throws(() => new DevKms(randomBytes(16)));
  });
});
