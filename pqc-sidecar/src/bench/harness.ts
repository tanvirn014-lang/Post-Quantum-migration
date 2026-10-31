import { fork, type ChildProcess } from "node:child_process";
import net from "node:net";
import tls from "node:tls";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createCertificateAuthority, issueServerCertificate } from "../pki/generate.js";
import { GROUP_X25519, GROUP_X25519_MLKEM768, groupName } from "../wire/groups.js";
import { HandshakeObserver } from "../wire/observer.js";
import { TapDuplex } from "../wire/tap.js";
import { bootstrapCI, describe, median, mean, verdictFromInterval, type ConfidenceInterval, type Distribution, type Verdict } from "./stats.js";

export type Condition = "classical" | "hybrid";

/** What each condition offers. Both talk to the SAME server configuration. */
export const CONDITIONS: Record<Condition, { clientGroups: string; expectedGroup: number }> = {
  classical: { clientGroups: "X25519", expectedGroup: GROUP_X25519 },
  hybrid: { clientGroups: "X25519MLKEM768", expectedGroup: GROUP_X25519_MLKEM768 },
};

export interface HandshakeSample {
  run: number;
  condition: Condition;
  /** 0 for the condition measured first in this run, 1 for the second (interleaving record). */
  position: number;
  seq: number;
  warmup: boolean;
  ok: boolean;
  handshakeMs: number | null;
  clientHelloBytes: number | null;
  serverHelloBytes: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  selectedGroup: string | null;
  expectedGroup: string;
  error: string | null;
}

export interface BenchServer {
  /** First listener port, kept for single-port callers. */
  port: number;
  /** All listener ports; spreading handshakes across them avoids ephemeral-port exhaustion. */
  ports: number[];
  caPem: string;
  cpu(): Promise<{ user: number; system: number; rss: number; handshakes: number }>;
  stop(): Promise<void>;
}

/** Starts the benchmark server in its own process with a fresh classical ECDSA certificate. */
export async function startBenchServer(groups = "X25519MLKEM768:X25519", listeners = 32): Promise<BenchServer> {
  const ca = await createCertificateAuthority("Benchmark CA", 1);
  const server = await issueServerCertificate(ca, { commonName: "bench-server", dnsNames: ["localhost"], ipAddresses: ["127.0.0.1"], days: 1 });
  const child: ChildProcess = fork(fileURLToPath(new URL("./server-process.js", import.meta.url)), [], { stdio: ["ignore", "ignore", "inherit", "ipc"] });

  const waitFor = <T extends { type: string }>(type: T["type"]): Promise<T> =>
    new Promise((resolve, reject) => {
      const onMessage = (m: T): void => {
        if (m.type !== type) return;
        child.off("message", onMessage);
        child.off("exit", onExit);
        resolve(m);
      };
      const onExit = (): void => reject(new Error("benchmark server exited unexpectedly"));
      child.on("message", onMessage);
      child.once("exit", onExit);
    });

  const listening = waitFor<{ type: "listening"; port: number; ports: number[] }>("listening");
  child.send({ type: "start", keyPem: server.keyPem, certPem: server.certPem, groups, listeners });
  const { port, ports } = await listening;

  return {
    port,
    ports,
    caPem: ca.certPem,
    async cpu() {
      const reply = waitFor<{ type: "cpu"; user: number; system: number; rss: number; handshakes: number }>("cpu");
      child.send({ type: "cpu" });
      return reply;
    },
    async stop() {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.send({ type: "stop" });
      await exited;
    },
  };
}

interface OneHandshake {
  ok: boolean;
  handshakeMs: number | null;
  clientHelloBytes: number | null;
  serverHelloBytes: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  selectedGroup: string | null;
  error: string | null;
}

/** One full TLS 1.3 handshake on a fresh connection. Timing starts after TCP connect. */
export async function handshakeOnce(port: number, caPem: string, clientGroups: string): Promise<OneHandshake> {
  const fail = (error: string): OneHandshake => ({ ok: false, handshakeMs: null, clientHelloBytes: null, serverHelloBytes: null, bytesSent: null, bytesReceived: null, selectedGroup: null, error });
  let raw: net.Socket;
  try {
    raw = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(port, "127.0.0.1");
      s.setNoDelay(true);
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
  } catch (err) {
    return fail((err as Error).message);
  }
  raw.on("error", () => {});
  const observer = new HandshakeObserver();
  const tap = new TapDuplex(raw, observer, "client");
  const started = performance.now();

  return new Promise<OneHandshake>((resolve) => {
    const socket = tls.connect({ socket: tap, servername: "localhost", ca: caPem, minVersion: "TLSv1.3", ecdhCurve: clientGroups });
    socket.once("secureConnect", () => {
      const elapsed = performance.now() - started;
      const obs = observer.observation;
      const result: OneHandshake = {
        ok: true,
        handshakeMs: elapsed,
        clientHelloBytes: obs.clientHello?.recordBytes ?? null,
        serverHelloBytes: obs.serverHello?.recordBytes ?? null,
        bytesSent: tap.bytesOut,
        bytesReceived: tap.bytesIn,
        selectedGroup: obs.serverHello?.selectedGroup === undefined ? null : (groupName(obs.serverHello.selectedGroup) ?? `0x${obs.serverHello.selectedGroup.toString(16)}`),
        error: null,
      };
      // Timing was captured above. The server ends the connection as soon as its side of the handshake
      // is done (so its CPU cost is counted), and the client waits for that instead of closing first.
      // Whoever closes first holds the TIME_WAIT entry; if the client did, tens of thousands of runs
      // would exhaust the client's ephemeral ports (EADDRINUSE) and fail handshakes at random.
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        raw.destroy();
        resolve(result);
      };
      socket.once("close", finish);
      socket.once("error", finish);
      setTimeout(finish, 250).unref();
    });
    socket.once("error", (err) => {
      raw.destroy();
      resolve(fail(err.message.split("\n")[0]!));
    });
  });
}

/** Round-robin over the listener ports (or the single port). */
function portRotation(port: number, ports?: number[]): () => number {
  const list = ports && ports.length > 0 ? ports : [port];
  let i = 0;
  return () => list[i++ % list.length]!;
}

export interface LatencyOptions {
  port: number;
  /** When given, handshakes rotate over these ports instead of always using `port`. */
  ports?: number[];
  caPem: string;
  runs: number;
  handshakesPerRun: number;
  /** Handshakes per condition discarded before run 0 so JIT/connection paths are warm. */
  warmup: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Experiment A. Conditions are INTERLEAVED per run (classical-first on even runs, hybrid-first on
 * odd runs) so slow drift of the machine cannot masquerade as an effect of the key agreement.
 */
export async function runLatency(opts: LatencyOptions): Promise<HandshakeSample[]> {
  const samples: HandshakeSample[] = [];
  const total = opts.runs * 2 * opts.handshakesPerRun;
  let done = 0;

  const nextPort = portRotation(opts.port, opts.ports);
  const measure = async (run: number, condition: Condition, position: number, count: number, warmup: boolean): Promise<void> => {
    const { clientGroups, expectedGroup } = CONDITIONS[condition];
    for (let seq = 0; seq < count; seq++) {
      const r = await handshakeOnce(nextPort(), opts.caPem, clientGroups);
      samples.push({ run, condition, position, seq, warmup, expectedGroup: groupName(expectedGroup)!, ...r });
      if (!warmup) opts.onProgress?.(++done, total);
    }
  };

  for (const condition of ["classical", "hybrid"] as const) await measure(-1, condition, condition === "classical" ? 0 : 1, opts.warmup, true);
  for (let run = 0; run < opts.runs; run++) {
    const order: Condition[] = run % 2 === 0 ? ["classical", "hybrid"] : ["hybrid", "classical"];
    for (const [position, condition] of order.entries()) await measure(run, condition, position, opts.handshakesPerRun, false);
  }
  return samples;
}

export interface ThroughputRow {
  run: number;
  condition: Condition;
  concurrency: number;
  handshakes: number;
  failures: number;
  elapsedMs: number;
  handshakesPerSecond: number;
  clientCpuMsPerHandshake: number;
  serverCpuMsPerHandshake: number;
  serverRssMiB: number;
}

/** Experiment G. Fixed work per point, `concurrency` handshakes in flight, with CPU time of both processes. */
export async function runThroughput(opts: { port: number; ports?: number[]; caPem: string; server: BenchServer; concurrency: number[]; handshakesPerPoint: number; runs: number }): Promise<ThroughputRow[]> {
  const rows: ThroughputRow[] = [];
  const nextPort = portRotation(opts.port, opts.ports);
  for (let run = 0; run < opts.runs; run++) {
    const order: Condition[] = run % 2 === 0 ? ["classical", "hybrid"] : ["hybrid", "classical"];
    for (const concurrency of opts.concurrency) {
      for (const condition of order) {
        const { clientGroups } = CONDITIONS[condition];
        const serverBefore = await opts.server.cpu();
        const clientBefore = process.cpuUsage();
        const started = performance.now();
        let next = 0;
        let failures = 0;
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            while (next < opts.handshakesPerPoint) {
              next += 1;
              const r = await handshakeOnce(nextPort(), opts.caPem, clientGroups);
              if (!r.ok) failures += 1;
            }
          }),
        );
        const elapsedMs = performance.now() - started;
        const clientCpu = process.cpuUsage(clientBefore);
        const serverAfter = await opts.server.cpu();
        const ok = opts.handshakesPerPoint - failures;
        rows.push({
          run,
          condition,
          concurrency,
          handshakes: opts.handshakesPerPoint,
          failures,
          elapsedMs,
          handshakesPerSecond: ok / (elapsedMs / 1000),
          clientCpuMsPerHandshake: (clientCpu.user + clientCpu.system) / 1000 / opts.handshakesPerPoint,
          serverCpuMsPerHandshake: (serverAfter.user + serverAfter.system - serverBefore.user - serverBefore.system) / 1000 / opts.handshakesPerPoint,
          serverRssMiB: serverAfter.rss / 1024 / 1024,
        });
      }
    }
  }
  return rows;
}

export interface ConditionSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  /** Handshakes whose negotiated group was not the one this condition is supposed to produce. */
  configurationMismatches: number;
  latencyMs: Distribution;
  perRunMedianMs: number[];
  medianOfRunMedians: ConfidenceInterval;
  clientHelloRecordBytes: number;
  serverHelloRecordBytes: number;
  bytesSentPerHandshake: number;
  bytesReceivedPerHandshake: number;
}

export interface LatencySummary {
  classical: ConditionSummary;
  hybrid: ConditionSummary;
  /** Paired per-run difference of median handshake time (hybrid minus classical), with a bootstrap CI over runs. */
  hybridMinusClassicalMedianMs: ConfidenceInterval;
  /** Hypothesis H2: is the extra time distinguishable from run-to-run variation? */
  h2Verdict: Verdict;
  /** Hypothesis H1: extra bytes on the wire per handshake. */
  h1: { extraClientHelloBytes: number; extraServerHelloBytes: number; extraBytesSent: number; extraBytesReceived: number };
}

function summarizeCondition(samples: HandshakeSample[], condition: Condition): ConditionSummary {
  const mine = samples.filter((s) => s.condition === condition && !s.warmup);
  const ok = mine.filter((s) => s.ok);
  const runs = [...new Set(mine.map((s) => s.run))].sort((a, b) => a - b);
  const perRunMedianMs = runs.map((r) => median(ok.filter((s) => s.run === r).map((s) => s.handshakeMs!)));
  const avg = (pick: (s: HandshakeSample) => number | null) => mean(ok.map(pick).filter((v): v is number => v !== null));
  return {
    attempted: mine.length,
    succeeded: ok.length,
    failed: mine.length - ok.length,
    configurationMismatches: ok.filter((s) => s.selectedGroup !== s.expectedGroup).length,
    latencyMs: describe(ok.map((s) => s.handshakeMs!)),
    perRunMedianMs,
    medianOfRunMedians: bootstrapCI(perRunMedianMs, median),
    clientHelloRecordBytes: avg((s) => s.clientHelloBytes),
    serverHelloRecordBytes: avg((s) => s.serverHelloBytes),
    bytesSentPerHandshake: avg((s) => s.bytesSent),
    bytesReceivedPerHandshake: avg((s) => s.bytesReceived),
  };
}

export function summarizeLatency(samples: HandshakeSample[]): LatencySummary {
  const classical = summarizeCondition(samples, "classical");
  const hybrid = summarizeCondition(samples, "hybrid");
  const n = Math.min(classical.perRunMedianMs.length, hybrid.perRunMedianMs.length);
  const diffs = Array.from({ length: n }, (_, i) => hybrid.perRunMedianMs[i]! - classical.perRunMedianMs[i]!);
  const ci = bootstrapCI(diffs, mean);
  return {
    classical,
    hybrid,
    hybridMinusClassicalMedianMs: ci,
    h2Verdict: verdictFromInterval(ci),
    h1: {
      extraClientHelloBytes: hybrid.clientHelloRecordBytes - classical.clientHelloRecordBytes,
      extraServerHelloBytes: hybrid.serverHelloRecordBytes - classical.serverHelloRecordBytes,
      extraBytesSent: hybrid.bytesSentPerHandshake - classical.bytesSentPerHandshake,
      extraBytesReceived: hybrid.bytesReceivedPerHandshake - classical.bytesReceivedPerHandshake,
    },
  };
}

export interface ThroughputSummaryRow {
  concurrency: number;
  condition: Condition;
  runs: number;
  handshakesPerSecondMedian: number;
  clientCpuMsPerHandshakeMedian: number;
  serverCpuMsPerHandshakeMedian: number;
  serverRssMiBMedian: number;
  failures: number;
}

export function summarizeThroughput(rows: ThroughputRow[]): ThroughputSummaryRow[] {
  const keys = [...new Set(rows.map((r) => `${r.concurrency}|${r.condition}`))];
  return keys.map((key) => {
    const [c, condition] = key.split("|") as [string, Condition];
    const group = rows.filter((r) => r.concurrency === Number(c) && r.condition === condition);
    return {
      concurrency: Number(c),
      condition,
      runs: group.length,
      handshakesPerSecondMedian: median(group.map((r) => r.handshakesPerSecond)),
      clientCpuMsPerHandshakeMedian: median(group.map((r) => r.clientCpuMsPerHandshake)),
      serverCpuMsPerHandshakeMedian: median(group.map((r) => r.serverCpuMsPerHandshake)),
      serverRssMiBMedian: median(group.map((r) => r.serverRssMiB)),
      failures: group.reduce((a, r) => a + r.failures, 0),
    };
  });
}

export function toCsv<T extends object>(rows: readonly T[], columns: readonly (keyof T & string)[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

export const HANDSHAKE_COLUMNS = ["run", "condition", "position", "seq", "warmup", "ok", "handshakeMs", "clientHelloBytes", "serverHelloBytes", "bytesSent", "bytesReceived", "selectedGroup", "expectedGroup", "error"] as const;
export const THROUGHPUT_COLUMNS = ["run", "condition", "concurrency", "handshakes", "failures", "elapsedMs", "handshakesPerSecond", "clientCpuMsPerHandshake", "serverCpuMsPerHandshake", "serverRssMiB"] as const;

export interface Validity {
  valid: boolean;
  problems: string[];
}

/** More than this share of failed handshakes in a condition makes the latency sample unrepresentative. */
export const MAX_FAILURE_RATE = 0.005;

/**
 * A run with failed handshakes is a harness or environment fault, not a result: failures drop the
 * slowest or most contended attempts from the sample and throughput divides by completed work.
 * Such a run is still written to disk for diagnosis, but it is flagged invalid and never published.
 */
export function assessValidity(latency: Pick<LatencySummary, "classical" | "hybrid">, throughput: Pick<ThroughputSummaryRow, "concurrency" | "condition" | "failures">[]): Validity {
  const problems: string[] = [];
  for (const condition of ["classical", "hybrid"] as const) {
    const c = latency[condition];
    if (c.attempted > 0 && c.failed / c.attempted > MAX_FAILURE_RATE) {
      problems.push(`${condition}: ${c.failed} of ${c.attempted} handshakes failed (limit ${MAX_FAILURE_RATE * 100}%); likely causes are ephemeral port exhaustion, CPU starvation or a server fault`);
    }
  }
  for (const row of throughput) {
    if (row.failures > 0) problems.push(`throughput concurrency ${row.concurrency} ${row.condition}: ${row.failures} failures`);
  }
  return { valid: problems.length === 0, problems };
}
