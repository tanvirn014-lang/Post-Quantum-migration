import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moscaAssessment, runHndlSimulation } from "../src/hndl/simulator.js";

describe("HNDL educational simulator: real primitives, modelled adversary", () => {
  it("labels itself a simulation and never claims a real attack", () => {
    const run = runHndlSimulation({ message: "toy secret", quantumAssumption: "x25519-broken" });
    assert.strictEqual(run.label, "SIMULATION");
    assert.match(run.disclaimer, /does not break any real key/i);
    assert.doesNotMatch(JSON.stringify(run), /quantum-(proof|safe|resistant)|real attack simulation/i);
  });

  it("recovers a captured classical (X25519-only) session once the X25519 secret is assumed recoverable", () => {
    const run = runHndlSimulation({ message: "pay 500 to account 7", quantumAssumption: "x25519-broken" });
    assert.strictEqual(run.sessions.classical.recovered, true);
    assert.strictEqual(run.sessions.classical.recoveredPlaintext, "pay 500 to account 7");
  });

  it("does not recover the captured hybrid session when only X25519 is broken, and shows why (AEAD authentication fails)", () => {
    const run = runHndlSimulation({ message: "pay 500 to account 7", quantumAssumption: "x25519-broken" });
    assert.strictEqual(run.sessions.hybrid.recovered, false);
    assert.strictEqual(run.sessions.hybrid.recoveredPlaintext, null);
    assert.match(run.sessions.hybrid.reason, /ML-KEM/);
  });

  it("recovers the hybrid session too when ML-KEM is also assumed broken: hybrid protection is only as strong as its stronger half", () => {
    const run = runHndlSimulation({ message: "both halves fall", quantumAssumption: "both-broken" });
    assert.strictEqual(run.sessions.hybrid.recovered, true);
    assert.strictEqual(run.sessions.hybrid.recoveredPlaintext, "both halves fall");
  });

  it("recovers nothing from either session when no break is assumed", () => {
    const run = runHndlSimulation({ message: "nothing breaks", quantumAssumption: "none" });
    assert.strictEqual(run.sessions.classical.recovered, false);
    assert.strictEqual(run.sessions.hybrid.recovered, false);
  });

  it("reports the real wire sizes of the captured key shares", () => {
    const run = runHndlSimulation({ message: "sizes", quantumAssumption: "none" });
    assert.strictEqual(run.sessions.classical.capture.clientKeyShareBytes, 32);
    assert.strictEqual(run.sessions.classical.capture.serverKeyShareBytes, 32);
    assert.strictEqual(run.sessions.hybrid.capture.clientKeyShareBytes, 1216);
    assert.strictEqual(run.sessions.hybrid.capture.serverKeyShareBytes, 1120);
  });

  it("never exposes private key material or the session key in its output", () => {
    const run = runHndlSimulation({ message: "no leaks", quantumAssumption: "both-broken" });
    const text = JSON.stringify(run);
    assert.doesNotMatch(text, /PRIVATE KEY/);
    assert.doesNotMatch(text, /"(privateKey|sessionKey|sharedSecret)"/);
  });

  it("uses fresh keys every run, so two runs capture different ciphertexts", () => {
    const a = runHndlSimulation({ message: "same", quantumAssumption: "none" });
    const b = runHndlSimulation({ message: "same", quantumAssumption: "none" });
    assert.notStrictEqual(a.sessions.classical.capture.ciphertextHex, b.sessions.classical.capture.ciphertextHex);
  });

  it("rejects empty and oversized toy messages", () => {
    assert.throws(() => runHndlSimulation({ message: "", quantumAssumption: "none" }), /message/);
    assert.throws(() => runHndlSimulation({ message: "x".repeat(257), quantumAssumption: "none" }), /message/);
  });
});

describe("Mosca inequality calculator", () => {
  it("flags risk when shelf life plus migration time exceeds the assumed years to a relevant quantum computer", () => {
    const r = moscaAssessment({ shelfLifeYears: 10, migrationYears: 5, yearsToQuantum: 12 });
    assert.strictEqual(r.atRisk, true);
    assert.strictEqual(r.exposureYears, 3);
  });

  it("is not at risk when the sum is within the assumption, including the boundary", () => {
    assert.strictEqual(moscaAssessment({ shelfLifeYears: 5, migrationYears: 5, yearsToQuantum: 10 }).atRisk, false);
    assert.strictEqual(moscaAssessment({ shelfLifeYears: 3, migrationYears: 2, yearsToQuantum: 20 }).exposureYears, 0);
  });

  it("states that the years-to-quantum figure is the user's assumption, not a prediction", () => {
    const r = moscaAssessment({ shelfLifeYears: 1, migrationYears: 1, yearsToQuantum: 1 });
    assert.match(r.note, /assumption/i);
    assert.match(r.note, /not a prediction/i);
  });

  it("rejects negative, non-finite and absurd inputs", () => {
    assert.throws(() => moscaAssessment({ shelfLifeYears: -1, migrationYears: 1, yearsToQuantum: 1 }), /shelfLifeYears/);
    assert.throws(() => moscaAssessment({ shelfLifeYears: 1, migrationYears: Number.NaN, yearsToQuantum: 1 }), /migrationYears/);
    assert.throws(() => moscaAssessment({ shelfLifeYears: 1, migrationYears: 1, yearsToQuantum: 1000 }), /yearsToQuantum/);
  });
});
