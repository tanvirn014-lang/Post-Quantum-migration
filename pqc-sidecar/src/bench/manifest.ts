import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The environment record of proposal Appendix C / D, captured automatically. */
export interface EnvironmentManifest {
  runId: string;
  startedAt: string;
  timeZone: string;
  operator: string;
  sourceRevision: { commit: string | null; workingTreeDirty: boolean | null };
  host: { os: string; release: string; version: string; arch: string; cpuModel: string; logicalCores: number; totalMemoryMiB: number };
  runtime: { node: string; openssl: string; v8: string };
  tls: { implementation: string; supportedGroupsUnderTest: string[]; minVersion: string; certificateSignature: string; resumption: string };
  topology: { networkMode: string; serverProcess: string; clientProcess: string; containers: string };
  dependencies: Record<string, string>;
  workload: Record<string, unknown>;
  measurement: Record<string, unknown>;
  capture: { packetCapture: string; handshakeByteSource: string };
  caveats: string[];
}

function tryGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function lockedVersions(packageRoot: string, names: string[]): Record<string, string> {
  try {
    const lock = JSON.parse(readFileSync(path.join(packageRoot, "package-lock.json"), "utf8")) as { packages?: Record<string, { version?: string }> };
    return Object.fromEntries(names.map((n) => [n, lock.packages?.[`node_modules/${n}`]?.version ?? "unknown"]));
  } catch {
    return Object.fromEntries(names.map((n) => [n, "unknown"]));
  }
}

export function collectManifest(opts: {
  runId: string;
  startedAt: Date;
  packageRoot: string;
  groupsUnderTest: string[];
  workload: Record<string, unknown>;
  measurement: Record<string, unknown>;
}): EnvironmentManifest {
  const cpus = os.cpus();
  const status = tryGit(["status", "--porcelain"]);
  return {
    runId: opts.runId,
    startedAt: opts.startedAt.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    operator: process.env["USERNAME"] ?? process.env["USER"] ?? "unknown",
    sourceRevision: { commit: tryGit(["rev-parse", "HEAD"]), workingTreeDirty: status === null ? null : status.length > 0 },
    host: {
      os: os.platform(),
      release: os.release(),
      version: os.version(),
      arch: os.arch(),
      cpuModel: cpus[0]?.model ?? "unknown",
      logicalCores: cpus.length,
      totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
    },
    runtime: { node: process.versions.node, openssl: process.versions.openssl, v8: process.versions.v8 },
    tls: {
      implementation: "node:tls on OpenSSL (X25519MLKEM768 and X25519 groups)",
      supportedGroupsUnderTest: opts.groupsUnderTest,
      minVersion: "TLSv1.3",
      certificateSignature: "ECDSA P-256 with SHA-256 (classical; identical in both conditions)",
      resumption: "disabled: every handshake is a full handshake (no session tickets, no reuse)",
    },
    topology: {
      networkMode: "loopback (127.0.0.1) on a single host",
      serverProcess: "separate Node.js child process",
      clientProcess: "harness process",
      containers: "none",
    },
    dependencies: lockedVersions(opts.packageRoot, ["@peculiar/x509", "pino", "zod", "typescript"]),
    workload: opts.workload,
    measurement: opts.measurement,
    capture: {
      packetCapture: "none retained; handshake sizes come from the plaintext ClientHello/ServerHello record lengths observed on the socket",
      handshakeByteSource: "wire bytes counted by the tap stream up to handshake completion, both directions",
    },
    caveats: [
      "Single host over loopback: latencies are not representative of any production or partner network.",
      "Client and server share one machine's CPU; contention is possible and run-to-run variation is reported, not hidden.",
      "Handshake timing excludes TCP connection setup and application data.",
      "Per-handshake CPU time comes from process.cpuUsage(), whose resolution is coarse on some platforms (notably Windows); treat CPU figures as averages over many handshakes, noisy at small sample sizes.",
      "The results characterise this implementation (Node.js/OpenSSL) in this environment only.",
    ],
  };
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
