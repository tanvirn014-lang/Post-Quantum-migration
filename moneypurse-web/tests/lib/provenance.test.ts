import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeProvenance, partnerProvenance } from "../../lib/provenance.js";

const partner = (tls: object, peer: object = { name: "Simulated Hybrid Bank" }) => ({ context: { channel: "partner", peer, tls } });

describe("partner provenance on a transaction", () => {
  it("reads the verified key exchange the core stored with a partner payment", () => {
    assert.deepStrictEqual(partnerProvenance(partner({ keyExchange: "hybrid", negotiatedGroup: "X25519MLKEM768", decision: "allowed-hybrid" })), {
      peerName: "Simulated Hybrid Bank",
      keyExchange: "hybrid",
      negotiatedGroup: "X25519MLKEM768",
    });
    assert.strictEqual(partnerProvenance(partner({ keyExchange: "classical", negotiatedGroup: "X25519" }))?.keyExchange, "classical");
  });

  it("returns null for ordinary transactions and for anything it does not recognise", () => {
    assert.strictEqual(partnerProvenance(undefined), null);
    assert.strictEqual(partnerProvenance({}), null);
    assert.strictEqual(partnerProvenance({ context: { channel: "api", actor: { userId: "u" } } }), null);
    assert.strictEqual(partnerProvenance({ context: "forged" }), null);
    assert.strictEqual(partnerProvenance(partner({ keyExchange: "quantum-proof" })), null, "an unknown key-exchange class is not displayed");
    assert.strictEqual(partnerProvenance(partner({ keyExchange: "hybrid" }, { name: 42 })), null);
  });

  it("labels hybrid, classical fallback and unverified honestly and always states the limits", () => {
    const hybrid = describeProvenance({ peerName: "P", keyExchange: "hybrid", negotiatedGroup: "X25519MLKEM768" });
    assert.strictEqual(hybrid.tone, "success");
    assert.match(hybrid.label, /hybrid key exchange/);
    const classical = describeProvenance({ peerName: "P", keyExchange: "classical", negotiatedGroup: "X25519" });
    assert.strictEqual(classical.tone, "warning");
    assert.match(classical.label, /classical key exchange \(fallback\)/);
    assert.match(classical.explanation, /no post-quantum key-establishment protection/);
    const unknown = describeProvenance({ peerName: "P", keyExchange: "unknown", negotiatedGroup: null });
    assert.strictEqual(unknown.tone, "neutral");
    for (const d of [hybrid, classical, unknown]) {
      assert.match(d.explanation, /plain HTTP/);
      assert.doesNotMatch(`${d.label} ${d.explanation}`, /quantum-(proof|safe|resistant)|fully secure/i);
    }
  });
});
