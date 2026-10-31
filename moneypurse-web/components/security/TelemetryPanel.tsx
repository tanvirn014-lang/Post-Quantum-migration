"use client";

import { useState } from "react";
import {
  useAcknowledgeAlert,
  useAlerts,
  useConnections,
  type ConnectionEvent,
  type Decision,
  type KeyExchange,
} from "../../hooks/useSecurity";
import { useCanSecurity } from "../../hooks/useSession";
import {
  DECISION_LABEL,
  KEY_EXCHANGE_LABEL,
  decisionTone,
  formatDateTime,
  formatGroupCode,
  formatMs,
  keyExchangeTone,
  severityTone,
} from "../../lib/security-format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Checkbox, Field, FormError, Select, TextInput } from "../ui/Form";
import { Drawer } from "../ui/Drawer";
import { DataTable, PageHeader, Panel, TD, TH, TR } from "../ui/PageHeader";
import { EmptyState, QueryBoundary, Skeleton } from "../ui/QueryState";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 border-t border-subtle py-2 text-sm first:border-t-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-primary">{children}</dd>
    </div>
  );
}

function ConnectionDetail({ e }: { e: ConnectionEvent }) {
  return (
    <dl>
      <Detail label="Decision">
        <Badge tone={decisionTone(e.decision)}>{DECISION_LABEL[e.decision]}</Badge> <span className="text-xs text-muted">severity {e.severity}</span>
      </Detail>
      <Detail label="Reason">{e.reason}</Detail>
      <Detail label="Time">{formatDateTime(e.occurredAt)}</Detail>
      <Detail label="Peer">{e.peerName ?? "Unregistered"}</Detail>
      <Detail label="Expected profile">{e.expectedProfile ?? "-"}</Detail>
      <Detail label="Key exchange">
        <Badge tone={keyExchangeTone(e.keyExchange)}>{KEY_EXCHANGE_LABEL[e.keyExchange]}</Badge>
      </Detail>
      <Detail label="Negotiated group">
        {e.negotiatedGroup ?? "-"} <span className="font-mono text-xs text-muted">{formatGroupCode(e.negotiatedGroupCode)}</span>
      </Detail>
      <Detail label="Offered groups">
        {e.offeredGroups.length === 0
          ? "-"
          : e.offeredGroups.map((g) => `${g.name ?? "unknown"} (${formatGroupCode(g.code)})`).join(", ")}
      </Detail>
      <Detail label="Key share bytes">
        client {e.clientKeyShareBytes ?? "-"}, server {e.serverKeyShareBytes ?? "-"}
      </Detail>
      <Detail label="TLS / cipher">
        {e.tlsVersion ?? "-"} / {e.cipher ?? "-"}
      </Detail>
      <Detail label="Handshake">{formatMs(e.handshakeMs)}</Detail>
      <Detail label="Config version">v{e.configVersion}</Detail>
      <Detail label="Certificate">
        <span className="font-mono text-xs">{e.certSha256 ?? "none presented"}</span>
      </Detail>
      <Detail label="Remote address">{e.remoteAddr ?? "-"}</Detail>
      <Detail label="Correlation id">
        <span className="font-mono text-xs">{e.correlationId}</span>
      </Detail>
      {e.acknowledgedAt && (
        <Detail label="Acknowledged">
          {formatDateTime(e.acknowledgedAt)}
          {e.ackNote ? ` - ${e.ackNote}` : ""}
        </Detail>
      )}
    </dl>
  );
}

function ConnectionsView() {
  const [decision, setDecision] = useState<Decision | "">("");
  const [keyExchange, setKeyExchange] = useState<KeyExchange | "">("");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [selected, setSelected] = useState<ConnectionEvent | null>(null);

  const query = useConnections({
    ...(decision ? { decision } : {}),
    ...(keyExchange ? { keyExchange } : {}),
    ...(alertsOnly ? { alertsOnly: true } : {}),
  });
  const events = query.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <Panel title="Connections">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Decision">
          {(id) => (
            <Select id={id} value={decision} onChange={(e) => setDecision(e.target.value as Decision | "")}>
              <option value="">All decisions</option>
              {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
                <option key={d} value={d}>
                  {DECISION_LABEL[d]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Key exchange">
          {(id) => (
            <Select id={id} value={keyExchange} onChange={(e) => setKeyExchange(e.target.value as KeyExchange | "")}>
              <option value="">All</option>
              <option value="hybrid">Hybrid</option>
              <option value="classical">Classical</option>
              <option value="unknown">Unverified</option>
            </Select>
          )}
        </Field>
        <div className="flex items-end">
          <Checkbox label="Alerts only" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} />
        </div>
      </div>

      <QueryBoundary query={query} skeleton={<Skeleton className="h-48" />}>
        {events.length === 0 ? (
          <EmptyState title="No connections recorded">Connections appear here once the sidecar evaluates them. Nothing is simulated.</EmptyState>
        ) : (
          <>
            <DataTable caption="Connection events">
              <thead>
                <tr>
                  <th className={TH}>Time</th>
                  <th className={TH}>Peer</th>
                  <th className={TH}>Key exchange</th>
                  <th className={TH}>Group</th>
                  <th className={TH}>Decision</th>
                  <th className={TH}>Handshake</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className={`${TR} cursor-pointer hover:bg-surface-overlay`} onClick={() => setSelected(e)}>
                    <td className={`${TD} text-xs`}>
                      <button type="button" className="text-left underline decoration-subtle hover:decoration-accent" onClick={() => setSelected(e)}>
                        {formatDateTime(e.occurredAt)}
                      </button>
                    </td>
                    <td className={TD}>{e.peerName ?? <span className="text-muted">Unregistered</span>}</td>
                    <td className={TD}>
                      <Badge tone={keyExchangeTone(e.keyExchange)}>{KEY_EXCHANGE_LABEL[e.keyExchange]}</Badge>
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{e.negotiatedGroup ?? "-"}</td>
                    <td className={TD}>
                      <Badge tone={decisionTone(e.decision)}>{DECISION_LABEL[e.decision]}</Badge>
                    </td>
                    <td className={TD}>{formatMs(e.handshakeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {query.hasNextPage && (
              <div className="mt-3">
                <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  {query.isFetchingNextPage ? "Loading..." : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </QueryBoundary>

      <Drawer open={selected !== null} onOpenChange={(open) => !open && setSelected(null)} title="Connection detail">
        {selected && <ConnectionDetail e={selected} />}
      </Drawer>
    </Panel>
  );
}

function AlertRow({ alert, canAcknowledge }: { alert: ConnectionEvent; canAcknowledge: boolean }) {
  const ack = useAcknowledgeAlert();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg bg-surface-overlay p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={severityTone(alert.severity)}>{alert.severity}</Badge>
        <Badge tone={decisionTone(alert.decision)}>{DECISION_LABEL[alert.decision]}</Badge>
        <span className="text-primary">{alert.peerName ?? "Unregistered peer"}</span>
        <span className="text-xs text-muted">{formatDateTime(alert.occurredAt)}</span>
      </div>
      <p className="mt-1 text-primary">{alert.reason}</p>
      <p className="mt-0.5 text-xs text-muted">
        Observed group {alert.negotiatedGroup ?? "none"}; expected profile {alert.expectedProfile ?? "n/a"}. An alert records a policy mismatch the sidecar could see; it is not
        proof of attack attribution.
      </p>
      {alert.acknowledgedAt ? (
        <p className="mt-2 text-xs text-muted">
          Acknowledged {formatDateTime(alert.acknowledgedAt)}
          {alert.ackNote ? ` - ${alert.ackNote}` : ""}
        </p>
      ) : (
        canAcknowledge && (
          <div className="mt-2">
            {open ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[14rem] flex-1">
                  <Field label="Note (optional)">
                    {(id) => <TextInput id={id} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}
                  </Field>
                </div>
                <Button variant="primary" disabled={ack.isPending} onClick={() => ack.mutate({ id: alert.id, ...(note.trim() ? { note: note.trim() } : {}) })}>
                  {ack.isPending ? "Saving..." : "Acknowledge"}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Acknowledge
              </Button>
            )}
            <FormError error={ack.error} />
          </div>
        )
      )}
    </li>
  );
}

function AlertsView() {
  const [includeAcknowledged, setIncludeAcknowledged] = useState(false);
  const query = useAlerts(includeAcknowledged);
  const canAcknowledge = useCanSecurity("alerts:acknowledge");
  const alerts = query.data ?? [];

  return (
    <Panel title="Alerts" actions={<Checkbox label="Include acknowledged" checked={includeAcknowledged} onChange={(e) => setIncludeAcknowledged(e.target.checked)} />}>
      <QueryBoundary query={query} skeleton={<Skeleton className="h-32" />}>
        {alerts.length === 0 ? (
          <EmptyState title="No open alerts">Classical fallbacks, unknown peers and policy violations appear here.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <AlertRow key={a.id} alert={a} canAcknowledge={canAcknowledge} />
            ))}
          </ul>
        )}
      </QueryBoundary>
    </Panel>
  );
}

export function TelemetryPanel() {
  const [tab, setTab] = useState<"connections" | "alerts">("connections");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Telemetry"
        description="Per-connection records from the sidecar: what the client offered, what was negotiated (verified from the ServerHello on the wire), the policy decision and why."
      />
      <div role="tablist" aria-label="Telemetry views" className="flex gap-2">
        {(["connections", "alerts"] as const).map((t) => (
          <Button key={t} role="tab" aria-selected={tab === t} variant={tab === t ? "primary" : "secondary"} onClick={() => setTab(t)}>
            {t === "connections" ? "Connections" : "Alerts"}
          </Button>
        ))}
      </div>
      {tab === "connections" ? <ConnectionsView /> : <AlertsView />}
    </div>
  );
}
