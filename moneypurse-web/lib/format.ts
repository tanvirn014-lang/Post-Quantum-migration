/**
 * Formats a minor-units amount (the wire format ledger-service uses, e.g. poisha for BDT)
 * as a taka string with the currency symbol, matching ledger-service's own convention of
 * carrying money as a decimal-string integer, never a float.
 */
export function formatCurrency(minorUnits: string, currency: string): string {
  const value = BigInt(minorUnits);
  const negative = value < 0n;
  const absValue = negative ? -value : value;
  const whole = absValue / 100n;
  const fraction = (absValue % 100n).toString().padStart(2, "0");
  const wholeWithCommas = whole.toLocaleString("en-US");
  const symbol = currency === "BDT" ? "৳" : currency;
  return `${negative ? "-" : ""}${symbol}${wholeWithCommas}.${fraction}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Renders an ISO timestamp as "N minutes/hours/days ago", falling back to a calendar
 *  date once it's more than a week old. */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(diffMs / MINUTE_MS));
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (diffMs < DAY_MS) {
    const hours = Math.floor(diffMs / HOUR_MS);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (diffMs < 7 * DAY_MS) {
    const days = Math.floor(diffMs / DAY_MS);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/**
 * Parses what a person types into an amount field ("1250", "1,250.5", "0.99") into positive
 * minor units (2 decimal places) as a string. Returns null for anything else - empty, zero,
 * negative, more than two decimals, non-numeric, or absurdly large. Never goes through a float.
 */
export function parseAmountToMinorUnits(input: string): string | null {
  const cleaned = input.trim().replace(/,/g, "");
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const minor = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return minor > 0n ? minor.toString() : null;
}
