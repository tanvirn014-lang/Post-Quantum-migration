import { z } from "zod";

/** ISO 4217-shaped currency code, normalized to uppercase. Shared so "BDT" vs "bdt" is
 *  accepted identically everywhere a currency appears in a request body. */
export const currencyCode = z
  .string()
  .length(3)
  .transform((c) => c.toUpperCase());

/** A signed integer amount in minor units, carried as a JSON string since JSON has no
 *  bigint type (see src/http/dto.ts for the same convention on the way out). */
export const minorUnitsString = z.string().regex(/^-?\d+$/, 'must be an integer string, e.g. "1050"');

// Account ids are "acc_<uuid>" (see src/domain/ids.ts), not bare UUIDs, so they're validated
// as opaque non-empty strings rather than with z.string().uuid().
export const accountId = z.string().min(1);
