// Money helpers. Amounts follow the Open Payments shape: an integer string in
// minor units plus assetCode/assetScale. All arithmetic uses BigInt; floats are
// never used for money.

export type Amount = {
  value: string;
  assetCode: string;
  assetScale: number;
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const MINOR_UNITS = /^\d+$/;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Parses a non-negative integer string in minor units. */
export function parseMinor(value: string): bigint {
  if (!MINOR_UNITS.test(value)) {
    throw new MoneyError(`Invalid minor-unit value: "${value}"`);
  }
  return BigInt(value);
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new MoneyError(`Invalid asset scale: ${scale}`);
  }
}

function assertSameAsset(a: Amount, b: Amount): void {
  if (a.assetCode !== b.assetCode || a.assetScale !== b.assetScale) {
    throw new MoneyError(
      `Asset mismatch: ${a.assetCode}/${a.assetScale} vs ${b.assetCode}/${b.assetScale}`,
    );
  }
}

/** Sums amounts of the same asset. Throws on an empty list or asset mismatch. */
export function sum(amounts: readonly Amount[]): Amount {
  const [first, ...rest] = amounts;
  if (!first) throw new MoneyError("Cannot sum an empty list of amounts");
  let total = parseMinor(first.value);
  for (const amount of rest) {
    assertSameAsset(first, amount);
    total += parseMinor(amount.value);
  }
  return { value: total.toString(), assetCode: first.assetCode, assetScale: first.assetScale };
}

/** a <= b, for amounts of the same asset. */
export function lte(a: Amount, b: Amount): boolean {
  assertSameAsset(a, b);
  return parseMinor(a.value) <= parseMinor(b.value);
}

/** Formats an amount for display, e.g. { value: "1250", USD, 2 } → "12.50 USD". */
export function toDisplay(amount: Amount): string {
  assertScale(amount.assetScale);
  const digits = parseMinor(amount.value).toString();
  const scale = amount.assetScale;
  if (scale === 0) return `${digits} ${amount.assetCode}`;
  const padded = digits.padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale);
  return `${whole}.${fraction} ${amount.assetCode}`;
}

/**
 * Converts a user-typed decimal string to minor units, e.g. ("12.5", 2) → "1250".
 * Rejects negatives, signs, exponents and more decimals than the scale allows.
 */
export function fromDecimalString(input: string, scale: number): string {
  assertScale(scale);
  const match = DECIMAL.exec(input.trim());
  if (!match) throw new MoneyError(`Invalid amount: "${input}"`);
  const whole = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > scale) {
    throw new MoneyError(`Amount "${input}" has more than ${scale} decimals`);
  }
  return BigInt(whole + fraction.padEnd(scale, "0")).toString();
}
