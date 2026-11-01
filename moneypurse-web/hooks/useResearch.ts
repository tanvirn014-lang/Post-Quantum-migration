import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiRequestError } from "../lib/api/api-client";
import { security } from "../lib/api/security-client";
import type { CbomComparison, MoscaInput, QuantumAssumption, ScenarioParams } from "../lib/api/security-types";

export function useCboms() {
  return useQuery({ queryKey: ["security", "cbom", "list"], queryFn: () => security.listCboms(20) });
}

export function useGroundTruth() {
  return useQuery({ queryKey: ["security", "cbom", "ground-truth"], queryFn: () => security.getGroundTruth() });
}

export function useGenerateCbom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (lookbackHours: number) => security.generateCbom(lookbackHours),
    onSuccess: () => client.invalidateQueries({ queryKey: ["security", "cbom", "list"] }),
  });
}

/** The stored comparison for one CBOM, or null when it has not been compared yet (the API answers 404). */
export function useCbomComparison(id: string | null) {
  return useQuery<CbomComparison | null>({
    queryKey: ["security", "cbom", "comparison", id],
    enabled: id !== null,
    queryFn: async () => {
      try {
        return await security.getCbomComparison(id!);
      } catch (err) {
        if (isApiRequestError(err) && err.status === 404) return null;
        throw err;
      }
    },
  });
}

export function useCompareCbom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => security.compareCbom(id),
    onSuccess: (result) => client.setQueryData(["security", "cbom", "comparison", result.cbomId], result),
  });
}

export function useHndlRuns() {
  return useQuery({ queryKey: ["security", "hndl", "runs"], queryFn: () => security.listHndlRuns(10) });
}

export function useRunHndl() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { message: string; quantumAssumption: QuantumAssumption }) => security.runHndl(vars.message, vars.quantumAssumption),
    onSuccess: () => client.invalidateQueries({ queryKey: ["security", "hndl", "runs"] }),
  });
}

export function useMosca() {
  return useMutation({ mutationFn: (input: MoscaInput) => security.mosca(input) });
}

export function useBenchmarks() {
  return useQuery({ queryKey: ["security", "benchmarks", "list"], queryFn: () => security.listBenchmarks(20) });
}

export function useBenchmark(runId: string | null) {
  return useQuery({ queryKey: ["security", "benchmarks", "detail", runId], enabled: runId !== null, queryFn: () => security.getBenchmark(runId!) });
}

export function useScenarios() {
  return useQuery({ queryKey: ["security", "experiments", "scenarios"], queryFn: () => security.listScenarios(), retry: false });
}

export function useRunScenario() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { scenarioId: string; params?: ScenarioParams }) => security.runScenario(vars.scenarioId, vars.params),
    // A run is a real connection to the sidecar, so telemetry and the overview change.
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: ["security", "overview"] }), client.invalidateQueries({ queryKey: ["security", "connections"] })]),
  });
}
