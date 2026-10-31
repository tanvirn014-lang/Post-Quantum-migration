/** Peer policy vocabulary shared with the sidecar (which enforces it). */
export const PEER_PROFILES = ["hybrid-required", "classical-allowed"] as const;
export type PeerProfile = (typeof PEER_PROFILES)[number];

export const KEY_EXCHANGES = ["hybrid", "classical", "unknown"] as const;
export type KeyExchange = (typeof KEY_EXCHANGES)[number];

export const DECISIONS = [
  "allowed-hybrid",
  "allowed-fallback",
  "rejected-violation",
  "rejected-unknown-peer",
  "handshake-failed",
] as const;
export type Decision = (typeof DECISIONS)[number];

export type Severity = "info" | "low" | "medium" | "high" | "critical";

/**
 * Severity is derived here from the decision, never accepted from the reporter, so there is
 * one definition of what counts as an alert.
 */
export function severityFor(decision: Decision): Severity {
  switch (decision) {
    case "allowed-hybrid":
      return "info";
    case "handshake-failed":
      return "low";
    case "allowed-fallback":
      return "medium";
    case "rejected-unknown-peer":
      return "high";
    case "rejected-violation":
      return "critical";
  }
}

/** Events needing human attention: explicit fallback, unknown peers, policy violations. */
export function isAlertSeverity(severity: Severity): boolean {
  return severity === "medium" || severity === "high" || severity === "critical";
}
