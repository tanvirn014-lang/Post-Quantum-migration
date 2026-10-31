import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectManifest, sha256Hex, type EnvironmentManifest } from "./manifest.js";
import {
  HANDSHAKE_COLUMNS,
  THROUGHPUT_COLUMNS,
  assessValidity,
  runLatency,
  runThroughput,
  startBenchServer,
  summarizeLatency,
  summarizeThroughput,
  toCsv,
  type LatencySummary,
  type Validity,
  type ThroughputSummaryRow,
} from "./harness.js";

interface Preset {
  runs: number;
  handshakesPerRun: number;
  warmup: number;
  concurrency: number[];
  throughputHandshakes: number;
  throughputRuns: number;
}

// Proposal experiment A asks for >= 30 runs of >= 1000 handshakes "if practical": `full` does that.
const PRESETS: Record<string, Preset> = {
  quick: { runs: 5, handshakesPerRun: 50, warmup: 20, concurrency: [1, 4], throughputHandshakes: 100, throughputRuns: 2 },
  standard: { runs: 30, handshakesPerRun: 300, warmup: 100, concurrency: [1, 4, 16], throughputHandshakes: 300, throughputRuns: 3 },
  full: { runs: 30, handshakesPerRun: 1000, warmup: 200, concurrency: [1, 4, 16, 64], throughputHandshakes: 1000, throughputRuns: 5 },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fmt = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : "n/a");

function report(manifest: EnvironmentManifest, latency: LatencySummary, throughput: ThroughputSummaryRow[], preset: string, validity: Validity): string {
  const c = latency.classical;
  const h = latency.hybrid;
  const ci = latency.hybridMinusClassicalMedianMs;
  const lines = [
    `# Handshake benchmark ${manifest.runId}`,
    "",
    ...(validity.valid ? [] : ["> **INVALID RUN - not evidence.** " + validity.problems.join("; "), ""]),
    `Preset: **${preset}** · ${manifest.startedAt} · commit ${manifest.sourceRevision.commit?.slice(0, 12) ?? "unknown"}${manifest.sourceRevision.workingTreeDirty ? " (dirty working tree)" : ""}`,
    `Host: ${manifest.host.cpuModel}, ${manifest.host.logicalCores} logical cores, ${manifest.host.totalMemoryMiB} MiB, ${manifest.host.os} ${manifest.host.release} · Node ${manifest.runtime.node}, OpenSSL ${manifest.runtime.openssl}`,
    "",
    "> Single host over loopback. These numbers characterise this implementation in this environment only; they are not production or partner-network latency and support no capacity claim.",
    "",
    "## Experiment A: classical (X25519) vs hybrid (X25519MLKEM768) full TLS 1.3 handshakes",
    "",
    "| | classical | hybrid |",
    "|---|---|---|",
    `| handshakes (ok / failed) | ${c.succeeded} / ${c.failed} | ${h.succeeded} / ${h.failed} |`,
    `| mean ms | ${fmt(c.latencyMs.mean)} | ${fmt(h.latencyMs.mean)} |`,
    `| median ms | ${fmt(c.latencyMs.median)} | ${fmt(h.latencyMs.median)} |`,
    `| p95 ms | ${fmt(c.latencyMs.p95)} | ${fmt(h.latencyMs.p95)} |`,
    `| p99 ms | ${fmt(c.latencyMs.p99)} | ${fmt(h.latencyMs.p99)} |`,
    `| std dev ms | ${fmt(c.latencyMs.stddev)} | ${fmt(h.latencyMs.stddev)} |`,
    `| ClientHello record bytes | ${fmt(c.clientHelloRecordBytes, 0)} | ${fmt(h.clientHelloRecordBytes, 0)} |`,
    `| ServerHello record bytes | ${fmt(c.serverHelloRecordBytes, 0)} | ${fmt(h.serverHelloRecordBytes, 0)} |`,
    `| wire bytes sent / received per handshake | ${fmt(c.bytesSentPerHandshake, 0)} / ${fmt(c.bytesReceivedPerHandshake, 0)} | ${fmt(h.bytesSentPerHandshake, 0)} / ${fmt(h.bytesReceivedPerHandshake, 0)} |`,
    `| configuration mismatches | ${c.configurationMismatches} | ${h.configurationMismatches} |`,
    "",
    `**H1 (extra bytes):** hybrid adds ${fmt(latency.h1.extraClientHelloBytes, 0)} B to the ClientHello record and ${fmt(latency.h1.extraServerHelloBytes, 0)} B to the ServerHello record; ${fmt(latency.h1.extraBytesSent, 0)} B more sent and ${fmt(latency.h1.extraBytesReceived, 0)} B more received per handshake.`,
    "",
    `**H2 (extra computation):** paired per-run difference of the median handshake time, hybrid minus classical = ${fmt(ci.estimate, 3)} ms (${Math.round(ci.level * 100)}% bootstrap CI over ${c.perRunMedianMs.length} runs: ${fmt(ci.lower, 3)} to ${fmt(ci.upper, 3)} ms). Verdict: **${latency.h2Verdict}**.`,
    "",
    "## Experiment G: throughput and resource cost",
    "",
    "| concurrency | condition | handshakes/s (median) | client CPU ms/hs | server CPU ms/hs | server RSS MiB | failures |",
    "|---|---|---|---|---|---|---|",
    ...throughput.map((r) => `| ${r.concurrency} | ${r.condition} | ${fmt(r.handshakesPerSecondMedian, 1)} | ${fmt(r.clientCpuMsPerHandshakeMedian, 3)} | ${fmt(r.serverCpuMsPerHandshakeMedian, 3)} | ${fmt(r.serverRssMiBMedian, 1)} | ${r.failures} |`),
    "",
    "## Caveats",
    "",
    ...manifest.caveats.map((x) => `- ${x}`),
    "",
  ];
  return lines.join("\n");
}

async function publish(payload: unknown): Promise<void> {
  const base = process.env["SECURITY_SERVICE_URL"];
  const token = process.env["BENCH_TOKEN"];
  if (!base || !token) {
    console.log("not published: set SECURITY_SERVICE_URL and BENCH_TOKEN");
    return;
  }
  const res = await fetch(new URL("/internal/v1/benchmarks", base), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  console.log(res.ok ? "published to security-service" : `publish failed: ${res.status} ${await res.text()}`);
}

async function main(): Promise<void> {
  const presetName = arg("preset") ?? "standard";
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`unknown preset ${presetName}; choose one of ${Object.keys(PRESETS).join(", ")}`);
  const label = arg("label") ?? presetName;
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const outRoot = path.resolve(arg("out") ?? path.join(packageRoot, "..", "evidence", "bench"));

  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${presetName}`;
  const manifest = collectManifest({
    runId,
    startedAt,
    packageRoot,
    groupsUnderTest: ["X25519", "X25519MLKEM768"],
    workload: {
      preset: presetName,
      label,
      runs: preset.runs,
      handshakesPerRunPerCondition: preset.handshakesPerRun,
      warmupHandshakesPerCondition: preset.warmup,
      throughputConcurrency: preset.concurrency,
      throughputHandshakesPerPoint: preset.throughputHandshakes,
      throughputRuns: preset.throughputRuns,
      connectionReuse: "none (new TCP connection and full handshake every time)",
      applicationData: "none",
      serverGroupList: "X25519MLKEM768:X25519 (identical for both conditions)",
      serverListeners: "32 loopback ports, identical configuration, handshakes rotate over them round-robin (avoids ephemeral-port exhaustion on one destination port)",
    },
    measurement: {
      timer: "performance.now() (monotonic)",
      handshakeTimeStart: "after TCP connect completes",
      handshakeTimeEnd: "TLS secureConnect event",
      interleaving: "classical-first on even runs, hybrid-first on odd runs",
      statistics: "linear-interpolated percentiles (R-7); bootstrap CIs resample independent RUNS (2000 resamples, recorded seed), not individual handshakes",
    },
  });

  const server = await startBenchServer();
  try {
    console.log(`benchmark ${runId}: ${preset.runs} runs x ${preset.handshakesPerRun} handshakes per condition`);
    let lastPct = -1;
    const samples = await runLatency({
      port: server.port,
      ports: server.ports,
      caPem: server.caPem,
      runs: preset.runs,
      handshakesPerRun: preset.handshakesPerRun,
      warmup: preset.warmup,
      onProgress: (done, total) => {
        const pct = Math.floor((done / total) * 10) * 10;
        if (pct !== lastPct) {
          lastPct = pct;
          console.log(`  latency ${pct}%`);
        }
      },
    });
    const throughputRows = await runThroughput({ port: server.port, ports: server.ports, caPem: server.caPem, server, concurrency: preset.concurrency, handshakesPerPoint: preset.throughputHandshakes, runs: preset.throughputRuns });

    const latency = summarizeLatency(samples);
    const throughput = summarizeThroughput(throughputRows);
    const validity = assessValidity(latency, throughput);
    const dir = path.join(outRoot, runId);
    await mkdir(dir, { recursive: true });

    const files: Record<string, string> = {
      "handshakes.csv": toCsv(samples, HANDSHAKE_COLUMNS),
      "throughput.csv": toCsv(throughputRows, THROUGHPUT_COLUMNS),
      "summary.json": JSON.stringify({ latency, throughput }, null, 2),
      "report.md": report(manifest, latency, throughput, presetName, validity),
    };
    const checksums = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, sha256Hex(content)]));
    files["manifest.json"] = JSON.stringify({ ...manifest, validity, outputs: { directory: dir, sha256: checksums } }, null, 2);
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
    await writeFile(path.join(dir, "checksums.sha256"), Object.entries(checksums).map(([n, h]) => `${h}  ${n}`).join("\n") + "\n");

    console.log(`\nwritten to ${dir}\n`);
    console.log(files["report.md"]);

    if (!validity.valid) {
      console.error(`
INVALID RUN, not published: ${validity.problems.join("; ")}`);
      process.exitCode = 3;
    } else if (process.argv.includes("--publish")) {
      await publish({ runId, label, manifest: { ...manifest, validity, outputs: { sha256: checksums } }, summary: { latency, throughput }, handshakesCsv: files["handshakes.csv"], throughputCsv: files["throughput.csv"] });
    }
  } finally {
    await server.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
