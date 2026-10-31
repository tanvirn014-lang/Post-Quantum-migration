import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectManifest, sha256Hex } from "../src/bench/manifest.js";
import { HANDSHAKE_COLUMNS, assessValidity, handshakeOnce, runLatency, runThroughput, startBenchServer, summarizeLatency, summarizeThroughput, toCsv, type HandshakeSample } from "../src/bench/harness.js";
import { bootstrapCI, describe as describeValues, mean, median, mulberry32, percentile, stddev, verdictFromInterval } from "../src/bench/stats.js";

describe("benchmark statistics", () => {
  it("computes mean, median, standard deviation and interpolated percentiles", () => {
    const v = [1, 2, 3, 4, 5];
    assert.strictEqual(mean(v), 3);
    assert.strictEqual(median(v), 3);
    assert.strictEqual(median([1, 2, 3, 4]), 2.5);
    assert.ok(Math.abs(stddev(v) - Math.sqrt(2.5)) < 1e-12);
    assert.ok(Math.abs(percentile(v, 95) - 4.8) < 1e-12, "R-7 linear interpolation");
    assert.strictEqual(percentile(v, 0), 1);
    assert.strictEqual(percentile(v, 100), 5);
    assert.strictEqual(percentile([7], 99), 7);
  });

  it("handles empty input without throwing and rejects out-of-range percentiles", () => {
    assert.ok(Number.isNaN(mean([])));
    assert.ok(Number.isNaN(percentile([], 50)));
    assert.strictEqual(stddev([5]), 0);
    assert.throws(() => percentile([1], 101), RangeError);
    assert.deepStrictEqual(describeValues([]).n, 0);
  });

  it("does not mutate its input when sorting", () => {
    const v = [3, 1, 2];
    percentile(v, 50);
    assert.deepStrictEqual(v, [3, 1, 2]);
  });

  it("describes a distribution", () => {
    const d = describeValues([1, 2, 3, 4, 100]);
    assert.deepStrictEqual([d.n, d.min, d.median, d.max], [5, 1, 3, 100]);
    assert.ok(d.p99 > d.p95 && d.p95 > d.median);
  });

  it("has a reproducible PRNG", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    assert.deepStrictEqual([a(), a(), a()], [b(), b(), b()]);
    assert.notStrictEqual(mulberry32(1)(), mulberry32(2)());
  });

  it("bootstrap CIs are deterministic for a recorded seed and bracket the estimate", () => {
    const samples = [10, 11, 9, 10.5, 9.5, 10.2, 10.8, 9.9];
    const a = bootstrapCI(samples, mean, { seed: 7, resamples: 500 });
    const b = bootstrapCI(samples, mean, { seed: 7, resamples: 500 });
    assert.deepStrictEqual(a, b);
    assert.ok(a.lower <= a.estimate && a.estimate <= a.upper);
    assert.ok(a.upper - a.lower < 2);
    assert.ok(Number.isNaN(bootstrapCI([], mean).estimate));
  });

  it("calls a difference distinguishable only when its interval excludes zero", () => {
    const base = { estimate: 1, level: 0.95, resamples: 1, seed: 1 };
    assert.strictEqual(verdictFromInterval({ ...base, lower: 0.2, upper: 1.5 }), "hybrid-slower");
    assert.strictEqual(verdictFromInterval({ ...base, lower: -1.5, upper: -0.2 }), "hybrid-faster");
    assert.strictEqual(verdictFromInterval({ ...base, lower: -0.5, upper: 0.5 }), "not-distinguishable");
  });

  it("a noise-only comparison is reported as not distinguishable", () => {
    const rand = mulberry32(99);
    const diffs = Array.from({ length: 30 }, () => rand() - 0.5);
    assert.strictEqual(verdictFromInterval(bootstrapCI(diffs, mean)), "not-distinguishable");
  });
});

describe("CSV and manifest", () => {
  it("escapes commas, quotes and newlines and writes empty cells for null", () => {
    const csv = toCsv([{ a: 'x,"y"', b: null, c: 1 }, { a: "line\nbreak", b: "ok", c: 2 }], ["a", "b", "c"]);
    assert.strictEqual(csv, 'a,b,c\n"x,""y""",,1\n"line\nbreak",ok,2\n');
  });

  it("captures the environment fields the proposal's manifest template requires", () => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const m = collectManifest({ runId: "t", startedAt: new Date("2026-11-01T00:00:00Z"), packageRoot, groupsUnderTest: ["X25519"], workload: { runs: 1 }, measurement: { timer: "x" } });
    assert.strictEqual(m.runtime.node, process.versions.node);
    assert.strictEqual(m.runtime.openssl, process.versions.openssl);
    assert.ok(m.host.logicalCores > 0 && m.host.cpuModel && m.host.totalMemoryMiB > 0);
    assert.match(m.tls.resumption, /disabled/);
    assert.match(m.tls.certificateSignature, /classical/);
    assert.ok(m.caveats.some((c) => /loopback/.test(c)));
    assert.strictEqual(typeof m.sourceRevision.workingTreeDirty === "boolean" || m.sourceRevision.workingTreeDirty === null, true);
    assert.strictEqual(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("handshake benchmark harness (real TLS against a separate server process)", () => {
  it("measures interleaved classical and hybrid handshakes and verifies the group each one actually negotiated", async () => {
    const server = await startBenchServer();
    try {
      const samples = await runLatency({ port: server.port, caPem: server.caPem, runs: 4, handshakesPerRun: 12, warmup: 5 });
      assert.strictEqual(samples.length, 2 * 5 + 4 * 2 * 12);
      assert.strictEqual(samples.filter((s) => s.warmup).length, 10);

      const firstCondition = (run: number) => samples.find((s) => s.run === run && s.position === 0)!.condition;
      assert.deepStrictEqual([0, 1, 2, 3].map(firstCondition), ["classical", "hybrid", "classical", "hybrid"], "conditions alternate which goes first");

      const measured = samples.filter((s) => !s.warmup);
      assert.ok(measured.every((s) => s.ok), JSON.stringify(measured.filter((s) => !s.ok)[0]));
      assert.ok(measured.every((s) => s.selectedGroup === s.expectedGroup), "every handshake negotiated the group its condition is meant to test");
      assert.ok(measured.every((s) => s.handshakeMs! > 0 && s.handshakeMs! < 5000));

      const summary = summarizeLatency(samples);
      assert.strictEqual(summary.classical.configurationMismatches, 0);
      assert.strictEqual(summary.hybrid.configurationMismatches, 0);
      assert.strictEqual(summary.classical.succeeded, 48);
      assert.strictEqual(summary.hybrid.perRunMedianMs.length, 4);
      assert.ok(summary.h1.extraClientHelloBytes > 1000, "hybrid ClientHello carries the ML-KEM encapsulation key");
      assert.ok(summary.h1.extraServerHelloBytes > 1000, "hybrid ServerHello carries the ML-KEM ciphertext");
      assert.ok(summary.h1.extraBytesSent > 1000 && summary.h1.extraBytesReceived > 1000);
      assert.ok(["hybrid-slower", "hybrid-faster", "not-distinguishable"].includes(summary.h2Verdict));

      const csv = toCsv(samples, HANDSHAKE_COLUMNS);
      assert.strictEqual(csv.split("\n")[0], HANDSHAKE_COLUMNS.join(","));
      assert.strictEqual(csv.trim().split("\n").length, samples.length + 1, "raw CSV keeps every observation, warm-ups included");
    } finally {
      await server.stop();
    }
  });

  it("records failures instead of hiding them when a condition cannot handshake (hybrid-only server vs classical client)", async () => {
    const server = await startBenchServer("X25519MLKEM768");
    try {
      const samples: HandshakeSample[] = await runLatency({ port: server.port, caPem: server.caPem, runs: 1, handshakesPerRun: 4, warmup: 0 });
      const summary = summarizeLatency(samples);
      assert.strictEqual(summary.classical.failed, 4);
      assert.strictEqual(summary.classical.succeeded, 0);
      assert.strictEqual(summary.hybrid.succeeded, 4);
      assert.ok(samples.filter((s) => s.condition === "classical").every((s) => s.error && !s.ok));
    } finally {
      await server.stop();
    }
  });

  it("measures throughput and per-handshake CPU for both conditions at each concurrency level", async () => {
    const server = await startBenchServer();
    try {
      const rows = await runThroughput({ port: server.port, caPem: server.caPem, server, concurrency: [1, 3], handshakesPerPoint: 18, runs: 2 });
      assert.strictEqual(rows.length, 2 * 2 * 2);
      assert.ok(rows.every((r) => r.failures === 0 && r.handshakesPerSecond > 0 && r.elapsedMs > 0));
      assert.ok(rows.every((r) => r.serverCpuMsPerHandshake >= 0 && r.clientCpuMsPerHandshake > 0 && r.serverRssMiB > 10));
      const summary = summarizeThroughput(rows);
      assert.strictEqual(summary.length, 4);
      assert.ok(summary.every((r) => r.runs === 2));
      const cpu = await server.cpu();
      assert.ok(cpu.handshakes >= 2 * 2 * 2 * 18, "the server really performed the handshakes");
    } finally {
      await server.stop();
    }
  });
});

describe("benchmark validity (a run with failed handshakes is never evidence)", () => {
  const okSummary = { attempted: 100, succeeded: 100, failed: 0 };
  const latency = (classical = okSummary, hybrid = okSummary) => ({ classical, hybrid }) as Parameters<typeof assessValidity>[0];

  it("accepts a run with no failures", () => {
    assert.deepStrictEqual(assessValidity(latency(), [{ concurrency: 1, condition: "classical", failures: 0 }] as never), { valid: true, problems: [] });
  });

  it("rejects a run whose failure rate exceeds 0.5% in either condition and names likely causes", () => {
    const r = assessValidity(latency(okSummary, { attempted: 1000, succeeded: 900, failed: 100 }), []);
    assert.strictEqual(r.valid, false);
    assert.match(r.problems.join(" "), /hybrid: 100 of 1000 handshakes failed/);
    assert.match(r.problems.join(" "), /ephemeral port/i);
  });

  it("tolerates a handful of failures below the threshold but reports no problem only under 0.5%", () => {
    assert.strictEqual(assessValidity(latency({ attempted: 1000, succeeded: 996, failed: 4 }), []).valid, true);
    assert.strictEqual(assessValidity(latency({ attempted: 1000, succeeded: 994, failed: 6 }), []).valid, false);
  });

  it("rejects a run with any failure at a throughput point, because throughput divides by completed handshakes", () => {
    const r = assessValidity(latency(), [{ concurrency: 4, condition: "hybrid", failures: 2 }] as never);
    assert.strictEqual(r.valid, false);
    assert.match(r.problems.join(" "), /concurrency 4 hybrid: 2 failures/);
  });
});

describe("benchmark server listeners (avoids ephemeral-port exhaustion on one destination port)", () => {
  it("listens on many distinct ports and completes handshakes on any of them", async () => {
    const server = await startBenchServer();
    try {
      assert.ok(server.ports.length >= 16, `expected many listener ports, got ${server.ports.length}`);
      assert.strictEqual(new Set(server.ports).size, server.ports.length);
      assert.strictEqual(server.port, server.ports[0]);
      const last = await handshakeOnce(server.ports.at(-1)!, server.caPem, "X25519MLKEM768");
      assert.ok(last.ok, last.error ?? "");
    } finally {
      await server.stop();
    }
  });

  it("spreads measured handshakes across the listener ports and still counts every one on the server", async () => {
    const server = await startBenchServer();
    try {
      const before = (await server.cpu()).handshakes;
      const samples = await runLatency({ port: server.port, ports: server.ports, caPem: server.caPem, runs: 1, handshakesPerRun: 20, warmup: 0 });
      assert.ok(samples.every((s) => s.ok));
      const after = (await server.cpu()).handshakes;
      assert.strictEqual(after - before, 40);
    } finally {
      await server.stop();
    }
  });
});
