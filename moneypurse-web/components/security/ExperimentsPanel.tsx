"use client";

import { useState, type FormEvent } from "react";
import type { Scenario, ScenarioResult } from "../../lib/api/security-types";
import { needsPaymentParams, parsePaymentParams, runErrorMessage, type PaymentFields } from "../../lib/scenario-params";
import { DECISION_LABEL } from "../../lib/security-format";
import { useCanSecurity } from "../../hooks/useSession";
import { useRunScenario, useScenarios } from "../../hooks/useResearch";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field, TextInput } from "../ui/Form";
import { PageHeader, Panel } from "../ui/PageHeader";
import { EmptyState, QueryBoundary, Skeleton } from "../ui/QueryState";
import { StatusBadge } from "../ui/StatusBadge";

const outcomeLabel = (o: string) => (o in DECISION_LABEL ? DECISION_LABEL[o as keyof typeof DECISION_LABEL] : o);

function ResultView({ result }: { result: ScenarioResult }) {
  const d = result.detail;
  return (
    <div className="space-y-2 rounded-lg bg-surface-overlay p-3 text-sm" aria-live="polite">
      <p>
        <Badge tone={result.passed ? "success" : "danger"}>{result.passed ? "Passed" : "Did not match"}</Badge>{" "}
        <span className="text-muted">
          expected <span className="font-medium text-primary">{outcomeLabel(result.expected)}</span>, observed <span className="font-medium text-primary">{outcomeLabel(result.observed)}</span>
        </span>
      </p>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Offered groups</dt>
          <dd>{d.offeredGroups.length > 0 ? d.offeredGroups.join(", ") : "-"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Selected group</dt>
          <dd>{d.selectedGroup ?? "-"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Handshake</dt>
          <dd>{d.connected ? `${d.handshakeMs ?? "?"} ms, ${d.protocol ?? "?"}` : "did not complete"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Sidecar decision seen by the peer</dt>
          <dd>{d.peerSawDecision ?? "-"}</dd>
        </div>
        {d.transactionId && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Ledger transaction</dt>
            <dd className="break-all font-mono">{d.transactionId}</dd>
          </div>
        )}
        {d.error && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Error</dt>
            <dd>{d.error}</dd>
          </div>
        )}
      </dl>
      {result.notes.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Run in {result.durationMs} ms. The run is recorded in the audit log and appears in the telemetry.</p>
    </div>
  );
}

function ScenarioCard({ scenario, canRun }: { scenario: Scenario; canRun: boolean }) {
  const run = useRunScenario();
  const payment = needsPaymentParams(scenario);
  const [fields, setFields] = useState<PaymentFields>({ toAccountId: "", amountMinorUnits: "2500", reference: "" });
  const [touched, setTouched] = useState(false);
  const parsed = payment ? parsePaymentParams(fields) : null;
  const errors = parsed && !parsed.ok && touched ? parsed.errors : {};
  const blocked = parsed !== null && !parsed.ok;
  const set = (key: keyof PaymentFields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canRun || blocked) return;
    try {
      await run.mutateAsync({ scenarioId: scenario.id, ...(parsed?.ok ? { params: parsed.params } : {}) });
    } catch {
      // shown below via run.error
    }
  }

  return (
    <section className="rounded-xl bg-surface-raised p-4" aria-labelledby={`s-${scenario.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`s-${scenario.id}`} className="text-base font-semibold text-primary">
          {scenario.title}
        </h2>
        <Badge tone="neutral">Experiment {scenario.experiment}</Badge>
        <StatusBadge status="SIM" title="Simulated peer: the peer is a test program on this host, not a real partner." />
      </div>
      <p className="mt-1 text-sm text-muted">{scenario.description}</p>
      <p className="mt-1 text-xs text-muted">
        Expected under the default profile: <span className="font-medium text-primary">{outcomeLabel(scenario.expected)}</span>. The peer is simulated.
      </p>

      <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
        {payment && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Customer account to credit (UUID)" hint="The customer account that receives the simulated payment." error={errors.toAccountId}>
              {(id) => <TextInput id={id} className="font-mono" value={fields.toAccountId} onChange={set("toAccountId")} autoComplete="off" spellCheck={false} disabled={!canRun} />}
            </Field>
            <Field label="Amount (minor units)" hint="Digits only; 2500 = 25.00." error={errors.amountMinorUnits}>
              {(id) => <TextInput id={id} inputMode="numeric" value={fields.amountMinorUnits} onChange={set("amountMinorUnits")} disabled={!canRun} />}
            </Field>
            <Field label="Reference (optional)" error={errors.reference}>
              {(id) => <TextInput id={id} value={fields.reference} maxLength={100} onChange={set("reference")} disabled={!canRun} />}
            </Field>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!canRun || run.isPending} aria-label={`Run ${scenario.title}`}>
            {run.isPending ? "Running..." : "Run scenario"}
          </Button>
          {!canRun && <span className="text-xs text-muted">Read-only: only a security administrator can run scenarios.</span>}
        </div>
      </form>

      {run.isError && (
        <div role="alert" className="mt-3 rounded-md bg-error-soft px-3 py-2 text-sm text-error">
          {runErrorMessage(run.error)}
        </div>
      )}
      {run.data && <div className="mt-3"><ResultView result={run.data} /></div>}
    </section>
  );
}

export function ExperimentsPanel() {
  const query = useScenarios();
  const canRun = useCanSecurity("experiments:run");
  const scenarios = query.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Experiments"
        description="Fixed scenarios that connect simulated peers to the live sidecar over real TLS 1.3 and record what the sidecar decided. The peers are test programs on this host, never real partners. Every run is audited."
        actions={<StatusBadge status="SIM" />}
      />
      {!canRun && <p className="text-xs text-muted">Read-only: your role can see the scenarios but not run them.</p>}
      <QueryBoundary query={query} skeleton={<Skeleton className="h-48" />}>
        {scenarios.length === 0 ? (
          <Panel title="Scenarios">
            <EmptyState title="No scenarios available">The peer simulator returned an empty list.</EmptyState>
          </Panel>
        ) : (
          <div className="space-y-3">
            {scenarios.map((s) => (
              <ScenarioCard key={s.id} scenario={s} canRun={canRun} />
            ))}
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
