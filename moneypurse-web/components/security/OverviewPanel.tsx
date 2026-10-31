"use client";

import { useOverview, type LatencyStats, type SidecarStatus } from "../../hooks/useSecurity";
import { DECISION_LABEL, KEY_EXCHANGE_LABEL, formatDateTime, formatMs } from "../../lib/security-format";
import { Badge } from "../ui/Badge";
import { DataTable, PageHeader, Panel, Stat, TD, TH, TR } from "../ui/PageHeader";
import { EmptyState, QueryBoundary, Skeleton } from "../ui/QueryState";

/** Nested counter objects (e.g. decisions) become dotted scalar rows instead of "[object Object]". */
export function flattenCounters(value: Record<string, unknown>, prefix = ""): [string, string][] {
  return Object.entries(value).flatMap(([k, v]) =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? flattenCounters(v as Record<string, unknown>, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)] as [string, string]],
  );
}

function SidecarCard({ s }: { s: SidecarStatus }) {
  const runtime = Object.entries(s.runtime);
  const counters = flattenCounters(s.counters);
  return (
    <div className="rounded-lg bg-surface-overlay p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-primary">{s.instanceId}</span>
        <Badge tone={s.stale ? "danger" : "success"}>{s.stale ? "Stale" : "Reporting"}</Badge>
        <Badge tone={s.inSync ? "success" : "warning"}>{s.inSync ? "Config in sync" : "Config out of sync"}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted">
        Last heartbeat {s.ageSeconds}s ago. Applied configuration v{s.appliedConfigVersion} ({s.activeProfile}). Started {formatDateTime(s.startedAt)}.
      </p>
      {runtime.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {runtime.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono text-primary">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {counters.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {counters.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono text-primary">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function LatencyRow({ kex, stats }: { kex: string; stats: LatencyStats }) {
  return (
    <tr className={TR}>
      <td className={TD}>{KEY_EXCHANGE_LABEL[kex as keyof typeof KEY_EXCHANGE_LABEL] ?? kex}</td>
      <td className={TD}>{stats.count}</td>
      <td className={TD}>{formatMs(stats.mean)}</td>
      <td className={TD}>{formatMs(stats.p50)}</td>
      <td className={TD}>{formatMs(stats.p95)}</td>
      <td className={TD}>{formatMs(stats.p99)}</td>
    </tr>
  );
}

export function OverviewPanel() {
  const query = useOverview();
  const o = query.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Live state of the TLS sidecar and the policy it enforces. Everything here is read from the running services; nothing is simulated."
      />
      <QueryBoundary query={query} skeleton={<Skeleton className="h-64" />}>
        {o && (
          <>
            <Panel title="Active TLS profile">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-primary">{o.config.profile}</span>
                <Badge>Configuration v{o.config.version}</Badge>
                {o.config.groups.map((g) => (
                  <Badge key={g} tone={g.includes("MLKEM") ? "success" : "warning"}>
                    {g}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted">{o.config.summary}</p>
              <p className="mt-1 text-xs text-muted">Changed {formatDateTime(o.config.changedAt)}. Applies to new connections only.</p>
            </Panel>

            <Panel title="Sidecar">
              {o.sidecars.length === 0 ? (
                <EmptyState title="No sidecar has reported yet">
                  Start the pqc-sidecar service. Until it sends a heartbeat there is no live connection data, and none is shown here.
                </EmptyState>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {o.sidecars.map((s) => (
                    <SidecarCard key={s.instanceId} s={s} />
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={`Connections, last ${o.telemetry.sinceHours} hours`}>
              {o.telemetry.total === 0 ? (
                <EmptyState title="No connections recorded in this window" />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Total connections" value={o.telemetry.total} />
                    <Stat label="Hybrid" value={o.telemetry.byKeyExchange["hybrid"] ?? 0} hint="Negotiated X25519MLKEM768" />
                    <Stat label="Classical" value={o.telemetry.byKeyExchange["classical"] ?? 0} hint="No post-quantum key establishment" />
                    <Stat
                      label="Open alerts"
                      value={o.telemetry.openAlerts}
                      hint="Fallbacks, unknown peers, violations. See Telemetry."
                    />
                  </div>
                  <DataTable caption="Connections by decision">
                    <thead>
                      <tr>
                        <th className={TH}>Decision</th>
                        <th className={TH}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(o.telemetry.byDecision).map(([decision, n]) => (
                        <tr key={decision} className={TR}>
                          <td className={TD}>{DECISION_LABEL[decision as keyof typeof DECISION_LABEL] ?? decision}</td>
                          <td className={TD}>{n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </div>
              )}
            </Panel>

            <Panel title="Handshake latency">
              {Object.keys(o.telemetry.handshakeMs).length === 0 ? (
                <EmptyState title="No timed handshakes yet" />
              ) : (
                <>
                  <DataTable caption="Handshake latency by key exchange">
                    <thead>
                      <tr>
                        <th className={TH}>Key exchange</th>
                        <th className={TH}>Samples</th>
                        <th className={TH}>Mean</th>
                        <th className={TH}>p50</th>
                        <th className={TH}>p95</th>
                        <th className={TH}>p99</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(o.telemetry.handshakeMs).map(([kex, stats]) => (
                        <LatencyRow key={kex} kex={kex} stats={stats} />
                      ))}
                    </tbody>
                  </DataTable>
                  <p className="mt-2 text-xs text-muted">Observed by the sidecar on this host. Not representative of production network latency.</p>
                </>
              )}
            </Panel>

            <Panel title="Peers">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Registered" value={o.peers.total} />
                <Stat label="Enabled" value={o.peers.enabled} />
                <Stat label="Hybrid required" value={o.peers.hybridRequired} />
              </div>
            </Panel>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
