"use client";

import { useState, type FormEvent } from "react";
import { security } from "../../lib/api/security-client";
import type { CbomComparison, CbomMeta } from "../../lib/api/security-types";
import { GROUND_TRUTH_CAVEATS, groupDiscrepancies, metricRows, parseLookbackHours, sourceHighlights } from "../../lib/cbom-format";
import { saveBlob } from "../../lib/download";
import { formatDateTime, shortFingerprint } from "../../lib/security-format";
import { useCanSecurity } from "../../hooks/useSession";
import { useCbomComparison, useCboms, useCompareCbom, useGenerateCbom, useGroundTruth } from "../../hooks/useResearch";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field, FormError, TextInput } from "../ui/Form";
import { DataTable, PageHeader, Panel, TD, TH, TR } from "../ui/PageHeader";
import { EmptyState, ErrorState, QueryBoundary, Skeleton } from "../ui/QueryState";
import { StatusBadge } from "../ui/StatusBadge";

function GenerateForm() {
  const generate = useGenerateCbom();
  const [hours, setHours] = useState("24");
  const parsed = parseLookbackHours(hours);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (parsed === null) return;
    try {
      await generate.mutateAsync(parsed);
    } catch {
      // shown below via generate.error
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" noValidate>
      <div className="w-56">
        <Field label="Telemetry look-back (hours)" hint="1 to 720. Handshakes seen in this window become observed assets." error={hours !== "" && parsed === null ? "Whole hours from 1 to 720." : undefined}>
          {(id) => <TextInput id={id} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />}
        </Field>
      </div>
      <Button type="submit" variant="primary" disabled={parsed === null || generate.isPending}>
        {generate.isPending ? "Generating..." : "Generate CBOM"}
      </Button>
      <div className="basis-full">
        <FormError error={generate.error} />
      </div>
    </form>
  );
}

function Download({ id }: { id: string }) {
  const [state, setState] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });

  async function download() {
    setState({ busy: true, error: null });
    try {
      const { blob, filename } = await security.downloadCbomDocument(id);
      saveBlob(blob, filename ?? `cbom-${id}.cdx.json`);
      setState({ busy: false, error: null });
    } catch (error) {
      setState({ busy: false, error });
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" onClick={() => void download()} disabled={state.busy}>
        {state.busy ? "Downloading..." : "Download CycloneDX JSON"}
      </Button>
      <FormError error={state.error} />
    </div>
  );
}

function ComparisonView({ comparison, currentVersion }: { comparison: CbomComparison; currentVersion: number | undefined }) {
  const truth = useGroundTruth();
  const groups = groupDiscrepancies(comparison.discrepancies);
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Compared {formatDateTime(comparison.createdAt)} against ground truth version {comparison.groundTruthVersion}.
      </p>
      <dl className="grid gap-2 sm:grid-cols-3">
        {metricRows(comparison.metrics).map((m) => (
          <div key={m.label} className="rounded-lg bg-surface-overlay p-3">
            <dt className="text-xs text-muted">{m.label}</dt>
            <dd className="mt-1 text-xl font-semibold text-primary">{m.value}</dd>
            <dd className="mt-0.5 text-xs text-muted">{m.detail}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-lg border border-subtle p-3 text-sm" role="note" aria-label="How to read these numbers">
        <p className="font-medium text-primary">Read these numbers with their scope</p>
        {truth.data ? (
          <dl className="mt-2 space-y-1 text-muted">
            <div>
              <dt className="inline font-medium text-primary">Ground-truth scope: </dt>
              <dd className="inline">{truth.data.scope}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-primary">Prepared by: </dt>
              <dd className="inline">{truth.data.preparedBy}</dd>
            </div>
            {currentVersion !== undefined && currentVersion !== comparison.groundTruthVersion && (
              <div className="text-xs text-accent">
                The scope shown is version {currentVersion}, the current one; this comparison used version {comparison.groundTruthVersion}.
              </div>
            )}
          </dl>
        ) : truth.isError ? (
          <ErrorState error={truth.error} onRetry={() => void truth.refetch()} />
        ) : (
          <Skeleton className="mt-2 h-10" />
        )}
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          {GROUND_TRUTH_CAVEATS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted">No discrepancies: every ground-truth item was found and every generated asset is in the ground truth.</p>
      ) : (
        groups.map((g) => (
          <section key={g.type} aria-label={g.label}>
            <h3 className="text-sm font-semibold text-primary">
              {g.label} <span className="font-normal text-muted">({g.items.length})</span>
            </h3>
            <ul className="mt-1 space-y-1">
              {g.items.map((d, i) => (
                <li key={`${d.kind}-${d.name}-${i}`} className="rounded-lg bg-surface-overlay px-3 py-2 text-sm">
                  <span className="font-medium text-primary">{d.name}</span> <span className="text-xs text-muted">({d.kind})</span>
                  <p className="text-xs text-muted">{d.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function CbomDetail({ cbom, canGenerate }: { cbom: CbomMeta; canGenerate: boolean }) {
  const comparisonQuery = useCbomComparison(cbom.id);
  const compare = useCompareCbom();
  const truth = useGroundTruth();
  const highlights = sourceHighlights(cbom.sourceSummary);
  const comparison = compare.data?.cbomId === cbom.id ? compare.data : comparisonQuery.data;

  return (
    <Panel title={`CBOM ${cbom.id.slice(0, 8)}`} badge={<StatusBadge status="LIVE" />}>
      <div className="space-y-5">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Generated</dt>
            <dd>{formatDateTime(cbom.generatedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Specification</dt>
            <dd>CycloneDX {cbom.specVersion}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Content SHA-256</dt>
            <dd className="break-all font-mono text-xs">{cbom.contentSha256}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Assets</dt>
            <dd>
              {cbom.assets.total} total: {cbom.assets.declared} declared, {cbom.assets.observed} observed
            </dd>
          </div>
        </dl>

        <section aria-label="Schema validation">
          <h3 className="text-sm font-semibold text-primary">Schema validation</h3>
          <p className="mt-1 text-sm">
            <Badge tone={cbom.validation.valid ? "success" : "danger"}>{cbom.validation.valid ? "Valid" : "Invalid"}</Badge> <span className="text-muted">{cbom.validation.schema}</span>
          </p>
          {cbom.validation.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-300">
              {cbom.validation.errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono">{e.path}</span>: {e.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="What the generator read">
          <h3 className="text-sm font-semibold text-primary">What the generator read</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
            {highlights.telemetry && (
              <li>
                Telemetry window: {highlights.telemetry.lookbackHours ?? "?"} h, {highlights.telemetry.eventsInWindow ?? "?"} connection events, {highlights.telemetry.distinctTuples ?? "?"} distinct handshake
                combinations.
              </li>
            )}
            {highlights.activeProfile && <li>Active TLS profile when generated: {highlights.activeProfile}.</li>}
            <li>
              {highlights.refusedFiles.length === 0
                ? "No files were refused."
                : `${highlights.refusedFiles.length} file(s) refused (never read or discarded): ${highlights.refusedFiles.map((f) => `${f.path} - ${f.reason}`).join("; ")}`}
            </li>
            <li>
              {highlights.unverifiedLocations.length === 0
                ? "Every declared location was found in its file."
                : `${highlights.unverifiedLocations.length} declared location(s) could not be verified in the repository: ${highlights.unverifiedLocations.map((u) => `${u.entry} at ${u.path} (${u.check})`).join("; ")}`}
            </li>
          </ul>
          <p className="mt-1 text-xs text-muted">Declared assets come from a hand-maintained register re-checked in the named files; observed assets come from handshake telemetry. This is not full cryptographic discovery.</p>
        </section>

        <Download id={cbom.id} />

        <section aria-label="Comparison with the ground truth" className="space-y-3 border-t border-subtle pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary">Comparison with the manual ground truth</h3>
            {canGenerate ? (
              <Button variant="secondary" disabled={compare.isPending} onClick={() => compare.mutate(cbom.id)}>
                {compare.isPending ? "Comparing..." : comparison ? "Compare again" : "Compare with ground truth"}
              </Button>
            ) : (
              <span className="text-xs text-muted">Read-only: only a security administrator can run a comparison.</span>
            )}
          </div>
          <FormError error={compare.error} />
          {comparisonQuery.isLoading ? (
            <Skeleton className="h-24" />
          ) : comparisonQuery.isError ? (
            <ErrorState error={comparisonQuery.error} onRetry={() => void comparisonQuery.refetch()} />
          ) : comparison ? (
            <ComparisonView comparison={comparison} currentVersion={truth.data?.version} />
          ) : (
            <p className="text-sm text-muted">This CBOM has not been compared with the ground truth yet.</p>
          )}
        </section>
      </div>
    </Panel>
  );
}

export function CbomPanel() {
  const query = useCboms();
  const canGenerate = useCanSecurity("cbom:generate");
  const [selected, setSelected] = useState<string | null>(null);
  const cboms = query.data ?? [];
  const current = cboms.find((c) => c.id === selected) ?? cboms[0] ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="CBOM"
        description="A cryptographic bill of materials in CycloneDX 1.7 format, generated from a maintained usage register, public certificate files, dependency manifests and observed handshake telemetry, validated against the official schema and compared with a scoped manual ground truth."
      />
      <Panel title="Generate" badge={<StatusBadge status="LIVE" />}>
        {canGenerate ? <GenerateForm /> : <p className="text-sm text-muted">Read-only: only a security administrator can generate a CBOM.</p>}
      </Panel>
      <Panel title="Generated documents">
        <QueryBoundary query={query} skeleton={<Skeleton className="h-40" />}>
          {cboms.length === 0 ? (
            <EmptyState title="No CBOM generated yet">{canGenerate ? "Use Generate CBOM above to create the first one." : "A security administrator has not generated one yet."}</EmptyState>
          ) : (
            <DataTable caption="Generated CBOM documents">
              <thead>
                <tr>
                  <th className={TH}>Generated</th>
                  <th className={TH}>Assets (declared / observed)</th>
                  <th className={TH}>Schema</th>
                  <th className={TH}>Content SHA-256</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cboms.map((c) => (
                  <tr key={c.id} className={TR}>
                    <td className={TD}>{formatDateTime(c.generatedAt)}</td>
                    <td className={TD}>
                      {c.assets.total} ({c.assets.declared} / {c.assets.observed})
                    </td>
                    <td className={TD}>
                      <Badge tone={c.validation.valid ? "success" : "danger"}>{c.validation.valid ? "Valid" : "Invalid"}</Badge>
                    </td>
                    <td className={`${TD} font-mono text-xs`} title={c.contentSha256}>
                      {shortFingerprint(c.contentSha256)}
                    </td>
                    <td className={TD}>
                      <Button variant={current?.id === c.id ? "primary" : "ghost"} aria-pressed={current?.id === c.id} onClick={() => setSelected(c.id)} aria-label={`View CBOM ${c.id.slice(0, 8)}`}>
                        {current?.id === c.id ? "Viewing" : "View"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </QueryBoundary>
      </Panel>
      {current && <CbomDetail key={current.id} cbom={current} canGenerate={canGenerate} />}
    </div>
  );
}
