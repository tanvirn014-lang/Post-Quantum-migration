import { z } from "zod";

/** ISO 4217-shaped currency code, normalized to uppercase. Shared so "BDT" vs "bdt" is
 *  accepted identically everywhere a currency appears in a request body. */
export const currencyCode = z
  .string()
  .length(3)
  .transform((c) => c.toUpperCase());

/** Money crosses the wire as a decimal string of minor units (JSON has no bigint). At most 15
 *  digits keeps every value comfortably inside Postgres BIGINT, so a hostile oversized number
 *  is a 400 here rather than a 500 from the database. */
export const signedMinorUnitsString = z.string().regex(/^-?\d{1,15}$/, 'must be an integer string of at most 15 digits, e.g. "1050"');

/** A strictly positive amount. Transfers must use this: a zero or negative amount would
 *  silently reverse the direction of the transfer. */
export const positiveMinorUnitsString = z
  .string()
  .regex(/^\d{1,15}$/, 'must be a positive integer string of at most 15 digits, e.g. "1050"')
  .refine((v) => /[1-9]/.test(v), "must be greater than zero");

// Account ids are "acc_<uuid>" (see src/domain/ids.ts), not bare UUIDs, so they're validated
// as opaque non-empty strings rather than with z.string().uuid().
export const accountId = z.string().min(1).max(64);

/** Free text shown in statements. No control characters; bounded length. */
export const description = z
  .string()
  .min(1)
  .max(140)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]*$/, "must not contain control characters");

/** Trimmed, then validated: stray whitespace around a pasted address should not fail login. */
export const emailSchema = z.string().trim().max(254).pipe(z.email());

export const idempotencyKeyHeader = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/, "contains unsupported characters");

export const limitQuery = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
