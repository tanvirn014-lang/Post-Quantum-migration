import type { MoscaInput, QuantumAssumption } from "./api/security-types";

export const MESSAGE_MAX = 256;

export const ASSUMPTIONS: { value: QuantumAssumption; label: string }[] = [
  { value: "none", label: "No break (today)" },
  { value: "x25519-broken", label: "X25519 broken, ML-KEM holds" },
  { value: "both-broken", label: "Both X25519 and ML-KEM broken" },
];

/** Error text for the toy message, or null when it is acceptable (1 to 256 characters). */
export function messageError(message: string): string | null {
  if (message.length === 0) return "Enter a short toy message.";
  if (message.length > MESSAGE_MAX) return `At most ${MESSAGE_MAX} characters (${message.length} entered).`;
  return null;
}

export const MOSCA_MAX_YEARS = 100;

export interface MoscaFields {
  shelfLifeYears: string;
  migrationYears: string;
  yearsToQuantum: string;
}

export type MoscaParse = { ok: true; value: MoscaInput } | { ok: false; errors: Partial<Record<keyof MoscaFields, string>> };

const FIELD_LABEL: Record<keyof MoscaFields, string> = {
  shelfLifeYears: "Shelf life X",
  migrationYears: "Migration time Y",
  yearsToQuantum: "Years to a relevant quantum computer Z",
};

/** Validates the three Mosca inputs the way the API does: finite numbers from 0 to 100. */
export function parseMosca(fields: MoscaFields): MoscaParse {
  const errors: Partial<Record<keyof MoscaFields, string>> = {};
  const value = {} as MoscaInput;
  for (const key of Object.keys(FIELD_LABEL) as (keyof MoscaFields)[]) {
    const raw = fields[key].trim();
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > MOSCA_MAX_YEARS) errors[key] = `${FIELD_LABEL[key]}: a number of years from 0 to ${MOSCA_MAX_YEARS}.`;
    else value[key] = n;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

export function formatBytes(n: number | null | undefined): string {
  return n === null || n === undefined ? "-" : `${n.toLocaleString("en-US")} B`;
}
