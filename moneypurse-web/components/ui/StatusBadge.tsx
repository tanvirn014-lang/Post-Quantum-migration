import { Badge } from "./Badge";

export type Implementation = "LIVE" | "SIM" | "PLANNED";

const TONE = { LIVE: "success", SIM: "warning", PLANNED: "neutral" } as const;

const MEANING: Record<Implementation, string> = {
  LIVE: "Implemented and backed by automated tests or captured evidence.",
  SIM: "Simulated or educational. Not a live implementation.",
  PLANNED: "Not built yet.",
};

/** The LIVE / SIM / PLANNED vocabulary from the project proposal, rendered consistently. */
export function StatusBadge({ status, title }: { status: Implementation; title?: string }) {
  return (
    <span title={title ?? MEANING[status]}>
      <Badge tone={TONE[status]}>{status}</Badge>
    </span>
  );
}

/**
 * Marks a panel whose data does not come from a real backend. Required on every such panel:
 * simulated data must never look like a live feature.
 */
export function SimBadge({ what }: { what: string }) {
  return (
    <span title={`${what}: no backend exists for this. The data shown is a fixture for illustration and is not live.`}>
      <Badge tone="warning">SIMULATED</Badge>
    </span>
  );
}
