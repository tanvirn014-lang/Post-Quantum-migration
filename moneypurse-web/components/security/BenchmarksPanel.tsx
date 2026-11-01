"use client";

import { useState } from "react";
import { security } from "../../lib/api/security-client";
import type { BenchmarkDetail, BenchmarkIndexEntry } from "../../lib/api/security-types";
import { BENCHMARK_SCOPE_NOTE, VERDICT_LABEL, formatNumber, integrityView, latencyRows, verdictExplanation } from "../../lib/benchmark-format";
import { saveBlob } from "../../lib/download";
import { formatBytes } from "../../lib/hndl";
import { formatDateTime } from "../../lib/security-format";
import { useBenchmark, useBenchmarks } from "../../hooks/useResearch";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { FormError } from "../ui/Form";
import { DataTable, PageHeader, Panel, TD, TH, TR } from "../ui/PageHeader";
import { EmptyState, ErrorState, QueryBoundary, Skeleton } from "../ui/QueryState";
import { StatusBadge } from "../ui/StatusBadge";

function IntegrityBadge({ run }: { run: Pick<BenchmarkIndexEntry, "integrity"> }) {
  const view = integrityView(run.integrity);
  return <Badge tone={view.tone}>{view.label}</Badge>;
}

function CsvDownload({ run, which, label }: { run: BenchmarkIndexEntry; which: "handshakes" | "throughput"; label: string }) {
  const [state, setState] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });

  async function download() {
    setState({ busy: true, error: null });
    try {
      const { blob, filename } = await security.downloadBenchmarkCsv(run.runId, which);
      saveBlob(blob, filename ?? `${run.runId}-${which}.csv`);
      setState({ busy: false, error: null });
    } catch (error) {
      setState({ busy: false, error });
    }
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={() => void download()} disabled={state.busy}>
        {state.busy ? "Downloading..." : label}
      </Button>
      <p className="font-mono text-[11px] text-muted" title={run.csv[which].sha256}>
        {formatBytes(run.csv[which].bytes)} · sha256 {run.csv[which].sha256.slice(0, 16)}...
      </p>
      <FormError error={state.error} />
    </div>
  );
}

function Detail({ run }: { run: BenchmarkDetail }) {
  const view = integrityView(run.integrity);
  const { latency, throughput } = run.summary;
  const m = run.manifest;
  const commit = run.commit ?? m.sourceRevision?.commit ?? null;

  return (
    <Panel title={`Run ${run.runId}`} badge={<IntegrityBadge run={run} />}>
      <div className="space-y-5">
        {view.banner && (
          <div role="alert" className={`rounded-md px-4 py-3 text-sm ${run.integrity.status === "invalid" ? "bg-error-soft text-error" : "bg-accent-soft text-accent"}`}>
            {view.banner}
          </div>
        )}
        <p className="rounded-lg border border-subtle px-3 py-2 text-xs text-muted">{BENCHMARK_SCOPE_NOTE}</p>

        <section aria-label="Environment">
          <h3 className="text-sm font-semibold text-primary">Environment manifest</h3>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">CPU</dt>
              <dd>{m.host?.cpuModel ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Logical cores / memory</dt>
              <dd>
                {m.host?.logicalCores ?? "-"} cores · {m.host?.totalMemoryMiB ?? "-"} MiB
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Operating system</dt>
              <dd>{[m.host?.os, m.host?.release].filter(Boolean).join(" ") || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Node.js / OpenSSL</dt>
              <dd>
                {m.runtime?.node ?? "-"} / {m.runtime?.openssl ?? "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Source commit</dt>
              <dd className="font-mono text-xs">
                {commit ? commit.slice(0, 12) : "unknown"}
                {run.workingTreeDirty ? " (working tree had uncommitted changes)" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Workload</dt>
              <dd>
                {m.workload?.runs ?? "-"} runs × {m.workload?.handshakesPerRunPerCondition ?? "-"} handshakes per condition ({m.workload?.preset ?? "-"} preset), {m.workload?.warmupHandshakesPerCondition ?? "-"} warm-up
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Topology</dt>
              <dd>{m.topology?.networkMode ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Received</dt>
              <dd>{formatDateTime(run.receivedAt)}</dd>
            </div>
          </dl>
        </section>

        {latency ? (
          <>
            <section aria-label="Handshake latency">
              <h3 className="text-sm font-semibold text-primary">Experiment A: full TLS 1.3 handshake time</h3>
              <DataTable caption="Handshake latency, classical versus hybrid">
                <thead>
                  <tr>
                    <th className={TH}>Statistic</th>
                    <th className={TH}>Classical X25519</th>
                    <th className={TH}>Hybrid X25519MLKEM768</th>
                  </tr>
                </thead>
                <tbody>
                  {latencyRows(latency).map((r) => (
                    <tr key={r.label} className={TR}>
                      <td className={TD}>{r.label}</td>
                      <td className={TD}>{r.classical}</td>
                      <td className={TD}>{r.hybrid}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </section>

            <section aria-label="Hypotheses" className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-surface-overlay p-3">
                <h3 className="text-sm font-semibold text-primary">H1: extra bytes on the wire</h3>
                <ul className="mt-1 space-y-0.5 text-sm text-muted">
                  <li>ClientHello record: +{formatBytes(latency.h1.extraClientHelloBytes)}</li>
                  <li>ServerHello record: +{formatBytes(latency.h1.extraServerHelloBytes)}</li>
                  <li>Sent per handshake: +{formatBytes(latency.h1.extraBytesSent)}</li>
                  <li>Received per handshake: +{formatBytes(latency.h1.extraBytesReceived)}</li>
                </ul>
              </div>
              <div className="rounded-lg bg-surface-overlay p-3">
                <h3 className="text-sm font-semibold text-primary">H2: extra handshake time (hybrid minus classical)</h3>
                <p className="mt-1 text-sm">
                  <span className="text-xl font-semibold text-primary">{formatNumber(latency.hybridMinusClassicalMedianMs.estimate, 3)} ms</span>{" "}
                  <Badge tone={latency.h2Verdict === "not-distinguishable" ? "neutral" : "warning"}>{VERDICT_LABEL[latency.h2Verdict]}</Badge>
                </p>
                <p className="mt-1 text-xs text-muted">{verdictExplanation(latency.h2Verdict, latency.hybridMinusClassicalMedianMs)}</p>
              </div>
            </section>
          </>
        ) : (
          <p className="text-sm text-muted">This run carries no latency summary.</p>
        )}

        {throughput && throughput.length > 0 && (
          <section aria-label="Throughput">
            <h3 className="text-sm font-semibold text-primary">Experiment G: throughput and resource cost</h3>
            <DataTable caption="Throughput by concurrency and condition">
              <thead>
                <tr>
                  <th className={TH}>Concurrency</th>
                  <th className={TH}>Condition</th>
                  <th className={TH}>Handshakes/s (median)</th>
                  <th className={TH}>Client CPU ms/hs</th>
                  <th className={TH}>Server CPU ms/hs</th>
                  <th className={TH}>Server RSS MiB</th>
                  <th className={TH}>Failures</th>
                </tr>
              </thead>
              <tbody>
                {throughput.map((r) => (
                  <tr key={`${r.concurrency}-${r.condition}`} className={TR}>
                    <td className={TD}>{r.concurrency}</td>
                    <td className={TD}>{r.condition === "hybrid" ? "Hybrid" : "Classical"}</td>
                    <td className={TD}>{formatNumber(r.handshakesPerSecondMedian, 1)}</td>
                    <td className={TD}>{formatNumber(r.clientCpuMsPerHandshakeMedian, 3)}</td>
                    <td className={TD}>{formatNumber(r.serverCpuMsPerHandshakeMedian, 3)}</td>
                    <td className={TD}>{formatNumber(r.serverRssMiBMedian, 1)}</td>
                    <td className={TD}>{r.failures}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <p className="mt-1 text-xs text-muted">CPU time comes from process.cpuUsage(), whose resolution is coarse on some platforms; treat it as an average, not a precise figure.</p>
          </section>
        )}

        {m.caveats && m.caveats.length > 0 && (
          <section aria-label="Caveats">
            <h3 className="text-sm font-semibold text-primary">Caveats recorded with the run</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
              {m.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Raw data" className="grid gap-3 sm:grid-cols-2">
          <CsvDownload run={run} which="handshakes" label="Download raw handshakes CSV" />
          <CsvDownload run={run} which="throughput" label="Download raw throughput CSV" />
        </section>
      </div>
    </Panel>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const query = useBenchmark(runId);
  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return query.data ? <Detail run={query.data} /> : null;
}

export function BenchmarksPanel() {
  const query = useBenchmarks();
  const [selected, setSelected] = useState<string | null>(null);
  const runs = query.data ?? [];
  const current = runs.find((r) => r.runId === selected) ?? runs[0] ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Benchmarks"
        description="Interleaved classical versus hybrid TLS 1.3 handshake measurements with the raw data and the environment they were taken in. Runs are stored as immutable evidence; a run whose handshakes failed is flagged and never presented as a measurement."
        actions={<StatusBadge status="LIVE" />}
      />
      <p className="rounded-lg border border-subtle px-3 py-2 text-xs text-muted">{BENCHMARK_SCOPE_NOTE}</p>
      <Panel title="Stored runs">
        <QueryBoundary query={query} skeleton={<Skeleton className="h-32" />}>
          {runs.length === 0 ? (
            <EmptyState title="No benchmark run has been published">Run npm run bench -- --preset standard --publish in pqc-sidecar, with SECURITY_SERVICE_URL and BENCH_TOKEN set.</EmptyState>
          ) : (
            <DataTable caption="Stored benchmark runs">
              <thead>
                <tr>
                  <th className={TH}>Run</th>
                  <th className={TH}>Received</th>
                  <th className={TH}>Label</th>
                  <th className={TH}>Integrity</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.runId} className={TR}>
                    <td className={`${TD} font-mono text-xs`}>{r.runId}</td>
                    <td className={`${TD} text-xs text-muted`}>{formatDateTime(r.receivedAt)}</td>
                    <td className={TD}>{r.label}</td>
                    <td className={TD}>
                      <IntegrityBadge run={r} />
                      {r.integrity.status !== "valid" && <p className="mt-1 text-xs text-muted">{r.integrity.problems.join("; ")}</p>}
                    </td>
                    <td className={TD}>
                      <Button variant={current?.runId === r.runId ? "primary" : "ghost"} aria-pressed={current?.runId === r.runId} aria-label={`View run ${r.runId}`} onClick={() => setSelected(r.runId)}>
                        {current?.runId === r.runId ? "Viewing" : "View"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </QueryBoundary>
      </Panel>
      {current && <RunDetail key={current.runId} runId={current.runId} />}
    </div>
  );
}
