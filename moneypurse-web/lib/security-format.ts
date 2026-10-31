import type { Decision, KeyExchange, Severity } from "./api/security-types";

export type Tone = "neutral" | "success" | "warning" | "danger";

export const DECISION_LABEL: Record<Decision, string> = {
  "allowed-hybrid": "Allowed - hybrid",
  "allowed-fallback": "Allowed - classical fallback",
  "rejected-violation": "Rejected - policy violation",
  "rejected-unknown-peer": "Rejected - unknown peer",
  "handshake-failed": "Handshake failed",
};

export function decisionTone(decision: Decision): Tone {
  switch (decision) {
    case "allowed-hybrid":
      return "success";
    case "allowed-fallback":
      return "warning";
    case "rejected-violation":
    case "rejected-unknown-peer":
      return "danger";
    case "handshake-failed":
      return "neutral";
  }
}

export function severityTone(severity: Severity): Tone {
  switch (severity) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "neutral";
  }
}

export const KEY_EXCHANGE_LABEL: Record<KeyExchange, string> = {
  hybrid: "Hybrid",
  classical: "Classical",
  unknown: "Unverified",
};

export function keyExchangeTone(kex: KeyExchange): Tone {
  return kex === "hybrid" ? "success" : kex === "classical" ? "warning" : "neutral";
}

/** "1.23 ms" / "-" for a missing measurement. */
export function formatMs(ms: number | null | undefined): string {
  return ms === null || ms === undefined || Number.isNaN(ms) ? "-" : `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
}

/** Human text for how long a configuration change took to be applied by a running sidecar. */
export function formatTimeToApply(ms: number | null): string {
  if (ms === null) return "not yet applied by a sidecar";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

/** First 12 hex characters of a fingerprint, for tables. The full value stays in a title/detail. */
export function shortFingerprint(hex: string | null | undefined): string {
  return hex ? `${hex.slice(0, 12)}...` : "-";
}

/**
 * Normalizes a certificate fingerprint typed or pasted by an operator: strips colons and
 * whitespace, lowercases. Returns null unless it is exactly a SHA-256 (64 hex characters).
 */
export function normalizeFingerprint(input: string): string | null {
  const hex = input.replace(/[:\s]/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** The group code points as the TLS registry prints them, e.g. 0x11ec. */
export function formatGroupCode(code: number | null | undefined): string {
  return code === null || code === undefined ? "-" : `0x${code.toString(16).padStart(4, "0")}`;
}
