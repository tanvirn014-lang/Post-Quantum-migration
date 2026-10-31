"use client";

import { useComponentStatus } from "../../hooks/useSecurity";
import { PageHeader, Panel } from "../ui/PageHeader";
import { QueryBoundary, Skeleton } from "../ui/QueryState";
import { StatusBadge } from "../ui/StatusBadge";

/**
 * The honesty surface: what is actually implemented. The list comes from security-service,
 * where a LIVE or SIM entry must cite evidence files that exist in the repository.
 */
export function ComponentStatusPanel() {
  const query = useComponentStatus();
  const components = query.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Implementation status"
        description="Every capability is labelled LIVE, SIM or PLANNED. A LIVE or SIM label is only allowed when the component cites automated tests or retained evidence that exist in the repository."
      />
      <Panel title="Legend">
        <ul className="grid gap-2 text-sm text-muted sm:grid-cols-3">
          <li>
            <StatusBadge status="LIVE" /> Implemented and covered by tests or captured evidence.
          </li>
          <li>
            <StatusBadge status="SIM" /> Simulated or educational; never presented as real.
          </li>
          <li>
            <StatusBadge status="PLANNED" /> Not built. Out-of-scope items stay planned.
          </li>
        </ul>
      </Panel>
      <QueryBoundary query={query} skeleton={<Skeleton className="h-96" />}>
        <div className="space-y-3">
          {components.map((c) => (
            <section key={c.id} className="rounded-xl bg-surface-raised p-4" aria-labelledby={`c-${c.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`c-${c.id}`} className="text-base font-semibold text-primary">
                  {c.name}
                </h2>
                <StatusBadge status={c.status} />
                {c.outOfScope && <span className="text-xs text-muted">out of scope</span>}
              </div>
              <p className="mt-1 text-sm text-muted">{c.summary}</p>
              {c.evidence.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Evidence</p>
                  <ul className="mt-1 space-y-0.5">
                    {c.evidence.map((e) => (
                      <li key={e} className="font-mono text-xs text-primary break-all">
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {c.limitations.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Limitations</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
                    {c.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
        </div>
      </QueryBoundary>
    </div>
  );
}
