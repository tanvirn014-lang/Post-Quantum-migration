"use client";

import { useState } from "react";
import { useAuditEvents, useVerifyAuditChain, type AuditSource, type AuditEventDTO } from "../../hooks/useSecurity";
import { formatDateTime } from "../../lib/security-format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable, PageHeader, Panel, TD, TH, TR } from "../ui/PageHeader";
import { EmptyState, ErrorState, QueryBoundary, Skeleton } from "../ui/QueryState";

const SOURCE_LABEL: Record<AuditSource, string> = {
  "security-service": "Security configuration (security-service)",
  "ledger-service": "Banking and identity (ledger-service)",
};

function outcomeTone(outcome: AuditEventDTO["outcome"]) {
  return outcome === "success" ? "success" : outcome === "denied" ? "warning" : "danger";
}

function EventRow({ e }: { e: AuditEventDTO }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={TR}>
        <td className={`${TD} text-xs`}>{e.seq}</td>
        <td className={`${TD} text-xs`}>{formatDateTime(e.occurredAt)}</td>
        <td className={`${TD} font-mono text-xs`}>{e.action}</td>
        <td className={TD}>
          <Badge tone={outcomeTone(e.outcome)}>{e.outcome}</Badge>
        </td>
        <td className={`${TD} text-xs`}>{e.actorRole ?? "-"}</td>
        <td className={`${TD} text-xs break-all`}>{e.resourceType ? `${e.resourceType}${e.resourceId ? `: ${e.resourceId}` : ""}` : "-"}</td>
        <td className={TD}>
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Details"}
          </Button>
        </td>
      </tr>
      {open && (
        <tr className={TR}>
          <td colSpan={7} className="bg-surface-base px-3 py-2">
            <pre className="overflow-x-auto text-xs text-primary">{JSON.stringify({ details: e.details, correlationId: e.correlationId, ip: e.ip, hash: e.hash }, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function SourceAudit({ source }: { source: AuditSource }) {
  const query = useAuditEvents(source);
  const verify = useVerifyAuditChain(source);
  const events = query.data?.pages.flatMap((p) => p.events) ?? [];
  const result = verify.data;

  return (
    <div className="space-y-4">
      <Panel
        title="Chain integrity"
        actions={
          <Button variant="secondary" disabled={verify.isPending} onClick={() => verify.mutate()}>
            {verify.isPending ? "Verifying..." : "Verify chain"}
          </Button>
        }
      >
        <p className="text-sm text-muted">
          Each event hashes the one before it, so editing or deleting an earlier event is detectable. Deleting only the newest events is not detectable without a head hash recorded
          elsewhere.
        </p>
        {verify.isError && (
          <div className="mt-3">
            <ErrorState error={verify.error} />
          </div>
        )}
        {result && (
          <div role="status" className={`mt-3 rounded-md px-3 py-2 text-sm ${result.valid ? "bg-success-soft text-success" : "bg-error-soft text-error"}`}>
            {result.valid ? (
              <p>Chain valid: {result.eventsChecked} events verified.</p>
            ) : (
              <p>
                Chain broken at event {result.brokenAtSeq}: {result.reason}. {result.eventsChecked} events before it verified.
              </p>
            )}
            <p className="mt-1 break-all font-mono text-xs opacity-80">Head hash {result.headHash}</p>
          </div>
        )}
      </Panel>

      <Panel title="Events">
        <QueryBoundary query={query} skeleton={<Skeleton className="h-48" />}>
          {events.length === 0 ? (
            <EmptyState title="No audit events yet" />
          ) : (
            <>
              <DataTable caption={`Audit events from ${source}`}>
                <thead>
                  <tr>
                    <th className={TH}>#</th>
                    <th className={TH}>Time</th>
                    <th className={TH}>Action</th>
                    <th className={TH}>Outcome</th>
                    <th className={TH}>Actor role</th>
                    <th className={TH}>Resource</th>
                    <th className={TH}>
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <EventRow key={e.id} e={e} />
                  ))}
                </tbody>
              </DataTable>
              {query.hasNextPage && (
                <div className="mt-3">
                  <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                    {query.isFetchingNextPage ? "Loading..." : "Load older events"}
                  </Button>
                </div>
              )}
            </>
          )}
        </QueryBoundary>
      </Panel>
    </div>
  );
}

export function AuditPanel() {
  const [source, setSource] = useState<AuditSource>("security-service");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Tamper-evident, append-only audit records. Two independent logs: one for security configuration changes, one for banking and identity events. Each has its own chain."
      />
      <div role="tablist" aria-label="Audit log source" className="flex flex-wrap gap-2">
        {(Object.keys(SOURCE_LABEL) as AuditSource[]).map((s) => (
          <Button key={s} role="tab" aria-selected={source === s} variant={source === s ? "primary" : "secondary"} onClick={() => setSource(s)}>
            {SOURCE_LABEL[s]}
          </Button>
        ))}
      </div>
      <SourceAudit key={source} source={source} />
    </div>
  );
}
