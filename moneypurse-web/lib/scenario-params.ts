import type { Scenario, ScenarioParams } from "./api/security-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AMOUNT = /^[1-9]\d{0,14}$/;

/** Payment scenarios pay a customer account through the sidecar and core, so they need parameters. */
export function needsPaymentParams(scenario: Pick<Scenario, "id" | "requires">): boolean {
  return scenario.requires.includes("toAccountId") || scenario.id.startsWith("partner-payment-");
}

export interface PaymentFields {
  toAccountId: string;
  amountMinorUnits: string;
  reference: string;
}

export type PaymentParse = { ok: true; params: ScenarioParams } | { ok: false; errors: Partial<Record<keyof PaymentFields, string>> };

/** Mirrors the API checks so the form can explain a problem before anything is sent. */
export function parsePaymentParams(fields: PaymentFields): PaymentParse {
  const errors: Partial<Record<keyof PaymentFields, string>> = {};
  const toAccountId = fields.toAccountId.trim();
  const amount = fields.amountMinorUnits.trim();
  const reference = fields.reference.trim();

  if (!UUID.test(toAccountId)) errors.toAccountId = "Must be the UUID of a customer account.";
  if (!AMOUNT.test(amount)) errors.amountMinorUnits = "Digits only, in minor units (for example 2500 = 25.00), no leading zero, at most 15 digits.";
  if (reference.length > 100) errors.reference = "At most 100 characters.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, params: { toAccountId, amountMinorUnits: amount, ...(reference ? { reference } : {}) } };
}

/** Maps the API failure for "the peer simulator is unavailable" to a plain explanation. */
export function runErrorMessage(err: unknown): string {
  const e = err as { code?: string; status?: number; message?: string } | null;
  if (e?.code === "DEPENDENCY_UNAVAILABLE" || e?.status === 503) {
    return "The peer simulator is not configured or not reachable, so no scenario can run. Start it (npm run dev:simulator) and make sure security-service has PEER_SIM_URL and PEER_SIM_TOKEN set.";
  }
  return e?.message ?? "The scenario could not be run.";
}
