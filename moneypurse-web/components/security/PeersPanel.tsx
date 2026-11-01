"use client";

import { useState, type FormEvent } from "react";
import {
  useCreatePeer,
  useDeletePeer,
  usePeers,
  useUpdatePeer,
  type Peer,
  type PeerProfile,
} from "../../hooks/useSecurity";
import { useCanSecurity } from "../../hooks/useSession";
import { formatDateTime, normalizeFingerprint, shortFingerprint } from "../../lib/security-format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Checkbox, Field, FormError, Select, TextInput } from "../ui/Form";
import { DataTable, PageHeader, Panel, TD, TH, TR } from "../ui/PageHeader";
import { EmptyState, QueryBoundary, Skeleton } from "../ui/QueryState";

const PROFILE_LABEL: Record<PeerProfile, string> = {
  "hybrid-required": "Hybrid required",
  "classical-allowed": "Classical allowed",
};

function CreatePeerForm({ onDone }: { onDone: () => void }) {
  const create = useCreatePeer();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [profile, setProfile] = useState<PeerProfile>("hybrid-required");
  const [enabled, setEnabled] = useState(true);

  const normalized = normalizeFingerprint(fingerprint);
  const fingerprintError = fingerprint.length > 0 && !normalized ? "Must be a SHA-256 fingerprint: 64 hex characters (colons allowed)." : undefined;
  const valid = name.trim().length >= 2 && normalized !== null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !normalized) return;
    try {
      await create.mutateAsync({ name: name.trim(), description: description.trim(), certSha256: normalized, profile, enabled });
      onDone();
    } catch {
      // shown below via create.error
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field label="Name" hint="2-64 characters: letters, digits, space, dot, underscore, hyphen.">
        {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
      </Field>
      <Field label="Policy profile" hint="Hybrid required rejects a classical-only negotiation as a violation.">
        {(id) => (
          <Select id={id} value={profile} onChange={(e) => setProfile(e.target.value as PeerProfile)}>
            <option value="hybrid-required">Hybrid required</option>
            <option value="classical-allowed">Classical allowed (explicit fallback)</option>
          </Select>
        )}
      </Field>
      <div className="sm:col-span-2">
        <Field label="Client certificate SHA-256 fingerprint" error={fingerprintError} hint="The peer identity. A network address is never used as identity.">
          {(id) => <TextInput id={id} className="font-mono" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} autoComplete="off" spellCheck={false} />}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Description (optional)">
          {(id) => <TextInput id={id} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Checkbox label="Enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </div>
      <div className="sm:col-span-2">
        <FormError error={create.error} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={!valid || create.isPending}>
          {create.isPending ? "Registering..." : "Register peer"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PeerRow({ peer, canManage }: { peer: Peer; canManage: boolean }) {
  const update = useUpdatePeer();
  const remove = useDeletePeer();
  const [confirming, setConfirming] = useState(false);

  return (
    <tr className={TR}>
      <td className={TD}>
        <p className="font-medium">{peer.name}</p>
        {peer.description && <p className="text-xs text-muted">{peer.description}</p>}
      </td>
      <td className={TD}>
        {canManage ? (
          <Select
            aria-label={`Policy profile for ${peer.name}`}
            value={peer.profile}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ id: peer.id, patch: { profile: e.target.value as PeerProfile } })}
          >
            <option value="hybrid-required">{PROFILE_LABEL["hybrid-required"]}</option>
            <option value="classical-allowed">{PROFILE_LABEL["classical-allowed"]}</option>
          </Select>
        ) : (
          <Badge tone={peer.profile === "hybrid-required" ? "success" : "warning"}>{PROFILE_LABEL[peer.profile]}</Badge>
        )}
      </td>
      <td className={`${TD} font-mono text-xs`} title={peer.certSha256}>
        {shortFingerprint(peer.certSha256)}
      </td>
      <td className={TD}>
        {canManage ? (
          <Checkbox
            label={peer.enabled ? "Enabled" : "Disabled"}
            checked={peer.enabled}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ id: peer.id, patch: { enabled: e.target.checked } })}
          />
        ) : (
          <Badge tone={peer.enabled ? "success" : "neutral"}>{peer.enabled ? "Enabled" : "Disabled"}</Badge>
        )}
      </td>
      <td className={`${TD} text-xs text-muted`}>{formatDateTime(peer.updatedAt)}</td>
      <td className={TD}>
        {canManage && (
          <>
            <Button variant="ghost" onClick={() => setConfirming(true)} aria-label={`Delete ${peer.name}`}>
              Delete
            </Button>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={`Delete ${peer.name}?`}
              confirmLabel="Delete peer"
              danger
              busy={remove.isPending}
              onConfirm={() => remove.mutate(peer.id, { onSuccess: () => setConfirming(false) })}
            >
              <p>
                The sidecar will treat this certificate as unregistered and reject its connections (deny by default) once it applies the new configuration.
              </p>
              <FormError error={remove.error} />
            </ConfirmDialog>
          </>
        )}
        {update.error && <p className="text-xs text-error">{update.error.message}</p>}
      </td>
    </tr>
  );
}

export function PeersPanel() {
  const query = usePeers();
  const canManage = useCanSecurity("peers:manage");
  const [creating, setCreating] = useState(false);
  const peers = query.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Peers"
        description="Registered external peers and the policy the sidecar enforces for each. Peer identity is the client certificate fingerprint. Unregistered certificates are denied by default."
        actions={
          canManage && !creating ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Register peer
            </Button>
          ) : undefined
        }
      />
      {!canManage && <p className="text-xs text-muted">Read-only: your role cannot change the peer registry.</p>}
      {creating && (
        <Panel title="Register a peer">
          <CreatePeerForm onDone={() => setCreating(false)} />
        </Panel>
      )}
      <Panel title="Registry">
        <QueryBoundary query={query} skeleton={<Skeleton className="h-40" />}>
          {peers.length === 0 ? (
            <EmptyState title="No peers registered">Every connection is rejected as an unknown peer until a peer certificate is registered.</EmptyState>
          ) : (
            <DataTable caption="Registered peers">
              <thead>
                <tr>
                  <th className={TH}>Peer</th>
                  <th className={TH}>Policy</th>
                  <th className={TH}>Certificate</th>
                  <th className={TH}>State</th>
                  <th className={TH}>Updated</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => (
                  <PeerRow key={p.id} peer={p} canManage={canManage} />
                ))}
              </tbody>
            </DataTable>
          )}
        </QueryBoundary>
      </Panel>
    </div>
  );
}
