/** Pure comparison in minor units (bigint, never a float) - true when below the threshold. */
export function isLowBalance(balanceMinorUnits: string, thresholdMinorUnits: string): boolean {
  return BigInt(balanceMinorUnits) < BigInt(thresholdMinorUnits);
}
