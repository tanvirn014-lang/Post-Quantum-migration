/**
 * Money is always represented as integer minor units (e.g. poisha for BDT, cents for USD)
 * plus an ISO 4217 currency code. Never use floating point for money: 0.1 + 0.2 !== 0.3 in
 * IEEE 754, which is unacceptable for a ledger.
 */
export class Money {
  private constructor(
    public readonly minorUnits: bigint,
    public readonly currency: string,
  ) {}

  static of(minorUnits: bigint | number, currency: string): Money {
    const normalizedCurrency = currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      throw new Error(`Invalid ISO 4217 currency code: ${currency}`);
    }
    return new Money(BigInt(minorUnits), normalizedCurrency);
  }

  static zero(currency: string): Money {
    return Money.of(0n, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.minorUnits - other.minorUnits, this.currency);
  }

  negate(): Money {
    return Money.of(-this.minorUnits, this.currency);
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  toString(): string {
    return `${this.minorUnits.toString()} ${this.currency}`;
  }
}
