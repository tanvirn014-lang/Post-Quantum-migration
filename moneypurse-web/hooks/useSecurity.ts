import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ledger } from "../lib/api/ledger-client";
import {
  security,
  type ConnectionFilter,
  type CreatePeerInput,
  type CreateProfileInput,
  type UpdatePeerInput,
} from "../lib/api/security-client";

export type * from "../lib/api/security-types";
export type { AuditEventDTO, ChainVerification } from "../lib/api/types";

const LIVE_REFRESH_MS = 10_000;

export function useOverview() {
  return useQuery({ queryKey: ["security", "overview"], queryFn: () => security.getOverview(), refetchInterval: LIVE_REFRESH_MS });
}

export function useComponentStatus() {
  return useQuery({ queryKey: ["security", "components"], queryFn: () => security.getComponents() });
}

export function usePeers() {
  return useQuery({ queryKey: ["security", "peers"], queryFn: () => security.listPeers() });
}

function useInvalidateSecurity() {
  const client = useQueryClient();
  return (...parts: string[]) => client.invalidateQueries({ queryKey: ["security", ...parts] });
}

export function useCreatePeer() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: (input: CreatePeerInput) => security.createPeer(input),
    onSuccess: () => Promise.all([invalidate("peers"), invalidate("overview"), invalidate("config")]),
  });
}

export function useUpdatePeer() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdatePeerInput }) => security.updatePeer(vars.id, vars.patch),
    onSuccess: () => Promise.all([invalidate("peers"), invalidate("overview"), invalidate("config")]),
  });
}

export function useDeletePeer() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: (id: string) => security.deletePeer(id),
    onSuccess: () => Promise.all([invalidate("peers"), invalidate("overview"), invalidate("config")]),
  });
}

export function useCryptoConfig() {
  return useQuery({ queryKey: ["security", "config"], queryFn: () => security.getCryptoConfig(), refetchInterval: LIVE_REFRESH_MS });
}

export function useProfiles() {
  return useQuery({ queryKey: ["security", "profiles"], queryFn: () => security.listProfiles() });
}

export function useGroups() {
  return useQuery({ queryKey: ["security", "groups"], queryFn: () => security.listGroups() });
}

export function useProviders() {
  return useQuery({ queryKey: ["security", "providers"], queryFn: () => security.listProviders() });
}

export function useSetActiveProfile() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: (vars: { profile: string; note?: string }) => security.setActiveProfile(vars.profile, vars.note),
    onSuccess: () => Promise.all([invalidate("config"), invalidate("overview"), invalidate("profiles")]),
  });
}

export function useCreateProfile() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: (input: CreateProfileInput) => security.createProfile(input),
    onSuccess: () => Promise.all([invalidate("profiles"), invalidate("config")]),
  });
}

export function useConnections(filter: Omit<ConnectionFilter, "before">) {
  return useInfiniteQuery({
    queryKey: ["security", "connections", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => security.listConnections({ ...filter, limit: 25, ...(pageParam ? { before: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}

export function useAlerts(includeAcknowledged: boolean) {
  return useQuery({
    queryKey: ["security", "alerts", includeAcknowledged],
    queryFn: () => security.listAlerts(includeAcknowledged),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useAcknowledgeAlert() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: (vars: { id: string; note?: string }) => security.acknowledgeAlert(vars.id, vars.note),
    onSuccess: () => Promise.all([invalidate("alerts"), invalidate("connections"), invalidate("overview")]),
  });
}

export type AuditSource = "security-service" | "ledger-service";

/** Audit events from either service, newest first, loaded page by page. */
export function useAuditEvents(source: AuditSource) {
  return useInfiniteQuery({
    queryKey: ["security", "audit", source],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const opts = { limit: 25, ...(pageParam ? { beforeSeq: pageParam } : {}) };
      return source === "security-service" ? security.listAuditEvents(opts) : ledger.listAuditEvents(opts);
    },
    getNextPageParam: (last) => last.nextBeforeSeq ?? undefined,
  });
}

export function useVerifyAuditChain(source: AuditSource) {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: () => (source === "security-service" ? security.verifyAuditChain() : ledger.verifyAuditChain()),
    // Verifying is itself audited, so refresh the log it just wrote to.
    onSuccess: () => invalidate("audit", source),
  });
}
