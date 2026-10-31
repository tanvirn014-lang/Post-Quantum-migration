"use client";

import { useState, type FormEvent } from "react";
import {
  useCreateProfile,
  useCryptoConfig,
  useGroups,
  useProfiles,
  useProviders,
  useSetActiveProfile,
  type TlsProfile,
} from "../../hooks/useSecurity";
import { useCanSecurity } from "../../hooks/useSession";
import { formatDateTime, formatTimeToApply } from "../../lib/security-format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Checkbox, Field, FormError, TextInput } from "../ui/Form";
import { DataTable, PageHeader, Panel, TD, TH, TR } from "../ui/PageHeader";
import { QueryBoundary, Skeleton } from "../ui/QueryState";
import { StatusBadge } from "../ui/StatusBadge";

function GroupBadges({ groups }: { groups: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {groups.map((g) => (
        <Badge key={g} tone={g.includes("MLKEM") ? "success" : "warning"}>
          {g}
        </Badge>
      ))}
    </span>
  );
}

function ProfileCard({ profile, active, canManage }: { profile: TlsProfile; active: boolean; canManage: boolean }) {
  const setActive = useSetActiveProfile();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={`rounded-lg p-3 ${active ? "border border-accent bg-surface-overlay" : "bg-surface-overlay"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-primary">{profile.name}</span>
          {active && <Badge tone="success">Active</Badge>}
          {profile.builtin && <Badge>Built in</Badge>}
        </div>
        {canManage && !active && (
          <Button variant="secondary" onClick={() => setConfirming(true)} aria-label={`Activate ${profile.name}`}>
            Activate
          </Button>
        )}
      </div>
      <div className="mt-2">
        <GroupBadges groups={profile.groups} />
      </div>
      <p className="mt-2 text-xs text-muted">{profile.description}</p>
      <p className="mt-1 text-xs text-muted">{profile.summary}</p>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Activate ${profile.name}?`}
        confirmLabel="Activate profile"
        busy={setActive.isPending}
        onConfirm={() => setActive.mutate({ profile: profile.name }, { onSuccess: () => setConfirming(false) })}
      >
        <p>
          The sidecar will use this profile for <strong>new connections only</strong> once it applies the change; connections already established are not affected. The change is
          recorded in the audit log.
        </p>
        <p className="mt-2">{profile.summary}</p>
        <FormError error={setActive.error} />
      </ConfirmDialog>
    </div>
  );
}

function CreateProfileForm({ onDone }: { onDone: () => void }) {
  const groupsQuery = useGroups();
  const create = useCreateProfile();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const valid = /^[a-z0-9][a-z0-9-]{1,48}$/.test(name) && description.trim().length > 0 && selected.length > 0;

  function toggle(group: string, on: boolean) {
    setSelected((prev) => (on ? [...prev, group] : prev.filter((g) => g !== group)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    try {
      await create.mutateAsync({ name, description: description.trim(), groups: selected });
      onDone();
    } catch {
      // shown below
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <Field label="Name" hint="Lowercase letters, digits and hyphens.">
        {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
      </Field>
      <Field label="Description">
        {(id) => <TextInput id={id} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted">Groups, in preference order (only registered, supported groups are offered)</legend>
        {(groupsQuery.data ?? []).map((g) => (
          <Checkbox key={g.name} label={`${g.name} (${g.kind})`} checked={selected.includes(g.name)} onChange={(e) => toggle(g.name, e.target.checked)} />
        ))}
      </fieldset>
      <FormError error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!valid || create.isPending}>
          {create.isPending ? "Creating..." : "Create profile"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function CryptoAgilityPanel() {
  const config = useCryptoConfig();
  const profiles = useProfiles();
  const providers = useProviders();
  const canManage = useCanSecurity("config:manage");
  const [creating, setCreating] = useState(false);
  const activeName = config.data?.activeProfile.name;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Crypto agility"
        description="Which key-agreement groups the sidecar may use. This is configuration-level selection: the TLS library still performs the handshake, and the provider is not swapped per operation."
      />
      {!canManage && <p className="text-xs text-muted">Read-only: your role cannot change the cryptographic configuration.</p>}

      <Panel title="Active configuration">
        <QueryBoundary query={config} skeleton={<Skeleton className="h-28" />}>
          {config.data && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-primary">{config.data.activeProfile.name}</span>
                <Badge>Configuration v{config.data.version}</Badge>
                <GroupBadges groups={config.data.activeProfile.groups} />
              </div>
              <p className="text-sm text-muted">{config.data.summary.summary}</p>
              <p className="text-xs text-muted">Changed {formatDateTime(config.data.changedAt)}. Applies to new connections only.</p>
            </div>
          )}
        </QueryBoundary>
      </Panel>

      <Panel
        title="TLS profiles"
        actions={
          canManage && !creating ? (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              New profile
            </Button>
          ) : undefined
        }
      >
        {creating && (
          <div className="mb-4 rounded-lg border border-subtle p-3">
            <CreateProfileForm onDone={() => setCreating(false)} />
          </div>
        )}
        <QueryBoundary query={profiles} skeleton={<Skeleton className="h-40" />}>
          <div className="grid gap-3 lg:grid-cols-2">
            {(profiles.data ?? []).map((p) => (
              <ProfileCard key={p.name} profile={p} active={p.name === activeName} canManage={canManage} />
            ))}
          </div>
        </QueryBoundary>
      </Panel>

      <Panel title="Crypto providers">
        <QueryBoundary query={providers} skeleton={<Skeleton className="h-32" />}>
          <div className="space-y-3">
            {(providers.data ?? []).map((p) => (
              <div key={p.id} className="rounded-lg bg-surface-overlay p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-primary">{p.name}</span>
                  <StatusBadge status={p.status} />
                  <Badge tone={p.selectable ? "success" : "neutral"}>{p.selectable ? "Selectable" : "Not selectable"}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{p.library}</p>
                {p.supportedGroups.length > 0 && (
                  <div className="mt-2">
                    <GroupBadges groups={p.supportedGroups} />
                  </div>
                )}
                <p className="mt-2 text-xs text-muted">{p.notes}</p>
                {p.observed && Object.keys(p.observed).length > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Observed on the running sidecar:{" "}
                    <span className="font-mono text-primary">
                      {Object.entries(p.observed)
                        .map(([k, v]) => `${k} ${String(v)}`)
                        .join(", ")}
                    </span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </QueryBoundary>
      </Panel>

      <Panel title="Change history">
        <QueryBoundary query={config} skeleton={<Skeleton className="h-32" />}>
          <DataTable caption="Configuration change history">
            <thead>
              <tr>
                <th className={TH}>Version</th>
                <th className={TH}>Change</th>
                <th className={TH}>When</th>
                <th className={TH}>Time to apply</th>
              </tr>
            </thead>
            <tbody>
              {(config.data?.history ?? []).map((h) => (
                <tr key={h.version} className={TR}>
                  <td className={TD}>v{h.version}</td>
                  <td className={TD}>
                    <p>{h.summary}</p>
                    <p className="text-xs text-muted">{h.actorRole ? `by ${h.actorRole}` : "system"}</p>
                  </td>
                  <td className={`${TD} text-xs text-muted`}>{formatDateTime(h.changedAt)}</td>
                  <td className={`${TD} text-xs`}>{formatTimeToApply(h.timeToApplyMs)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <p className="mt-2 text-xs text-muted">
            Time to apply is measured from the change to the first sidecar heartbeat reporting that version. It reflects configuration reload, not a code-free or zero-downtime
            swap.
          </p>
        </QueryBoundary>
      </Panel>
    </div>
  );
}
