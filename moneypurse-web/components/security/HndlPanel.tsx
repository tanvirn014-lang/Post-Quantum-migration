"use client";

import { useState, type FormEvent } from "react";
import type { CapturedSession, HndlRun, QuantumAssumption } from "../../lib/api/security-types";
import { ASSUMPTIONS, MESSAGE_MAX, formatBytes, messageError, parseMosca, type MoscaFields } from "../../lib/hndl";
import { formatDateTime } from "../../lib/security-format";
import { useHndlRuns, useMosca, useRunHndl } from "../../hooks/useResearch";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field, FormError, TextInput } from "../ui/Form";
import { PageHeader, Panel } from "../ui/PageHeader";
import { EmptyState, QueryBoundary, Skeleton } from "../ui/QueryState";
import { StatusBadge } from "../ui/StatusBadge";

function SimulationBanner({ disclaimer }: { disclaimer: string | null }) {
  return (
    <div role="note" className="rounded-md border border-subtle bg-accent-soft px-4 py-3 text-sm">
      <p>
        <Badge tone="warning">SIMULATION</Badge> <span className="font-medium text-primary">Educational simulator, not an attack.</span>
      </p>
      <p className="mt-1 text-muted">
        {disclaimer ??
          "It does not break any real key and runs no quantum algorithm: the adversary capability is an assumption you choose, and the cryptography it then meets is real. Nothing here predicts when, or whether, such a computer will exist."}
      </p>
    </div>
  );
}

function SessionCard({ title, subtitle, session }: { title: string; subtitle: string; session: CapturedSession }) {
  return (
    <section className="rounded-lg bg-surface-overlay p-4" aria-label={title}>
      <h3 className="text-sm font-semibold text-primary">{title}</h3>
      <p className="text-xs text-muted">{subtitle}</p>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Client key share</dt>
          <dd>{formatBytes(session.capture.clientKeyShareBytes)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Server key share</dt>
          <dd>{formatBytes(session.capture.serverKeyShareBytes)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Captured ciphertext</dt>
          <dd>{formatBytes(session.capture.ciphertextBytes)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Recording opened by the modelled adversary</dt>
          <dd>
            <Badge tone={session.recovered ? "danger" : "success"}>{session.recovered ? "Yes" : "No"}</Badge>
          </dd>
        </div>
        {session.recovered && session.recoveredPlaintext !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Recovered plaintext</dt>
            <dd className="break-all font-mono text-xs">{session.recoveredPlaintext}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-sm text-muted">{session.reason}</p>
    </section>
  );
}

function RunResult({ run }: { run: HndlRun }) {
  return (
    <div className="space-y-4" aria-live="polite">
      <SimulationBanner disclaimer={run.disclaimer} />
      <p className="text-sm text-muted">
        <span className="font-medium text-primary">Assumption:</span> {run.assumptionExplained}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <SessionCard title="Classical X25519" subtitle="Session captured under a classical key agreement." session={run.sessions.classical} />
        <SessionCard title="Hybrid X25519MLKEM768" subtitle="Session captured under the hybrid key agreement." session={run.sessions.hybrid} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-primary">Takeaways</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {run.takeaways.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted">Real primitives used: {run.primitives.join(", ")}. The keys are generated fresh for each run and discarded.</p>
    </div>
  );
}

function SimulatorForm() {
  const run = useRunHndl();
  const [message, setMessage] = useState("pay 500 to account 7");
  const [assumption, setAssumption] = useState<QuantumAssumption>("x25519-broken");
  const error = messageError(message);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (error) return;
    try {
      await run.mutateAsync({ message, quantumAssumption: assumption });
    } catch {
      // shown below via run.error
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Toy message" hint={`A made-up message to encrypt, at most ${MESSAGE_MAX} characters. Do not enter real data.`} error={message.length > 0 ? (error ?? undefined) : undefined}>
          {(id) => <TextInput id={id} value={message} onChange={(e) => setMessage(e.target.value)} />}
        </Field>
        <fieldset>
          <legend className="text-xs font-medium text-muted">Assumed adversary capability</legend>
          <div className="mt-1 flex flex-col gap-1">
            {ASSUMPTIONS.map((a) => (
              <label key={a.value} className="flex items-center gap-2 text-sm text-primary">
                <input type="radio" name="assumption" value={a.value} checked={assumption === a.value} onChange={() => setAssumption(a.value)} className="accent-[var(--accent)]" />
                {a.label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">The break is an assumption you choose. No quantum computer is involved.</p>
        </fieldset>
        <Button type="submit" variant="primary" disabled={error !== null || run.isPending}>
          {run.isPending ? "Running..." : "Run simulation"}
        </Button>
      </form>
      <FormError error={run.error} />
      {run.data && <RunResult run={run.data} />}
    </div>
  );
}

function MoscaCard() {
  const mosca = useMosca();
  const [fields, setFields] = useState<MoscaFields>({ shelfLifeYears: "10", migrationYears: "5", yearsToQuantum: "12" });
  const parsed = parseMosca(fields);
  const errors = parsed.ok ? {} : parsed.errors;
  const set = (key: keyof MoscaFields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.ok) return;
    try {
      await mosca.mutateAsync(parsed.value);
    } catch {
      // shown below via mosca.error
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <p className="text-sm text-muted">
        Mosca&apos;s inequality: recorded data is exposed to harvest-now-decrypt-later if X + Y exceeds Z. Z is <span className="font-medium text-primary">your assumption, not a prediction</span>.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="X: years the data must stay confidential" error={errors.shelfLifeYears}>
          {(id) => <TextInput id={id} inputMode="decimal" value={fields.shelfLifeYears} onChange={set("shelfLifeYears")} />}
        </Field>
        <Field label="Y: years to migrate" error={errors.migrationYears}>
          {(id) => <TextInput id={id} inputMode="decimal" value={fields.migrationYears} onChange={set("migrationYears")} />}
        </Field>
        <Field label="Z: assumed years to a relevant quantum computer" error={errors.yearsToQuantum}>
          {(id) => <TextInput id={id} inputMode="decimal" value={fields.yearsToQuantum} onChange={set("yearsToQuantum")} />}
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={!parsed.ok || mosca.isPending}>
        {mosca.isPending ? "Calculating..." : "Calculate"}
      </Button>
      <FormError error={mosca.error} />
      {mosca.data && (
        <div className="rounded-lg bg-surface-overlay p-3 text-sm" aria-live="polite">
          <p>
            <Badge tone={mosca.data.atRisk ? "warning" : "success"}>{mosca.data.atRisk ? "Exposed under this assumption" : "Not exposed under this assumption"}</Badge>{" "}
            <span className="text-muted">
              X + Y = {mosca.data.shelfLifeYears + mosca.data.migrationYears} years against Z = {mosca.data.yearsToQuantum}; exposure {mosca.data.exposureYears} year(s).
            </span>
          </p>
          <p className="mt-1 text-xs text-muted">{mosca.data.note}</p>
        </div>
      )}
    </form>
  );
}

function PreviousRuns() {
  const query = useHndlRuns();
  const runs = query.data ?? [];
  return (
    <QueryBoundary query={query} skeleton={<Skeleton className="h-24" />}>
      {runs.length === 0 ? (
        <EmptyState title="No simulation runs yet">Runs are stored so they can be reviewed later.</EmptyState>
      ) : (
        <ul className="divide-y divide-subtle text-sm">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-muted">{formatDateTime(r.createdAt)}</span>
              <span>{ASSUMPTIONS.find((a) => a.value === r.assumption)?.label ?? r.assumption}</span>
              <span className="text-xs text-muted">
                classical {r.sessions.classical.recovered ? "opened" : "closed"}, hybrid {r.sessions.hybrid.recovered ? "opened" : "closed"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </QueryBoundary>
  );
}

export function HndlPanel() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Harvest now, decrypt later"
        description="An educational simulator. A toy session is captured under a classical and under a hybrid key agreement; a modelled adversary is then given whatever the chosen assumption says it can break, and real cryptography shows what that does and does not open."
        actions={<StatusBadge status="SIM" />}
      />
      <SimulationBanner disclaimer={null} />
      <Panel title="Simulator" badge={<Badge tone="warning">SIMULATION</Badge>}>
        <SimulatorForm />
      </Panel>
      <Panel title="Mosca calculator" badge={<Badge tone="warning">SIMULATION</Badge>}>
        <MoscaCard />
      </Panel>
      <Panel title="Previous runs">
        <PreviousRuns />
      </Panel>
    </div>
  );
}
