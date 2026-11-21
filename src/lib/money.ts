/**
 * Money is held as an integer number of centimes ("minor units") so sums and
 * ratios never pick up floating-point error. `null` means BLANK (not entered);
 * `0` is a real recorded zero. The two are never interchangeable.
 */
export type Minor = number;
export type Blank<T> = T | null;
/** A ratio in basis points: 12000 = 120.00 %. */
export type RatioBp = number;

/** Integer division rounded half away from zero. */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new RangeError("roundDiv needs finite numbers and a non-zero denominator");
  }
  const negative = numerator < 0 !== denominator < 0;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const quotient = Math.floor(n / d);
  const remainder = n - quotient * d;
  const rounded = remainder * 2 >= d ? quotient + 1 : quotient;
  return negative ? -rounded : rounded;
}

/** Convert a database `numeric(14,2)` string/number (e.g. "1000.50") to minor units. */
export function toMinor(amount: string | number): Minor {
  const text = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new RangeError(`Not a MAD amount: ${String(amount)}`);
  const [, sign, whole, fraction = ""] = match;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return sign === "-" ? -minor : minor;
}

export function toMinorOrBlank(amount: string | number | null | undefined): Blank<Minor> {
  return amount === null || amount === undefined || amount === "" ? null : toMinor(amount);
}

/** Exact decimal text for a minor amount, e.g. 60350 -> "603.50". Used for SQL and exports. */
export function toDecimalString(minor: Minor): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumMinor(values: ReadonlyArray<Blank<Minor>>): Minor {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/** Basis-point ratio num/den; blank when either side is blank or the denominator is 0. */
export function ratioBp(numerator: Blank<Minor>, denominator: Blank<Minor>): Blank<RatioBp> {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return roundDiv(numerator * 10000, denominator);
}

/** Growth = current / prior - 1, in basis points; blank when prior is blank or 0. */
export function growthBp(current: Blank<Minor>, prior: Blank<Minor>): Blank<RatioBp> {
  const ratio = ratioBp(current, prior);
  return ratio === null ? null : ratio - 10000;
}

/** Average order value in minor units (2 decimals); blank when orders are blank or 0. */
export function averageMinor(sales: Blank<Minor>, orders: Blank<number>): Blank<Minor> {
  if (sales === null || orders === null || orders === 0) return null;
  return roundDiv(sales, orders);
}

/**
 * Largest magnitude a PostgreSQL `numeric(14,2)` column holds: 999,999,999,999.99 MAD,
 * i.e. 99,999,999,999,999 centimes. It is below Number.MAX_SAFE_INTEGER, so every amount
 * inside the range is exact in a JavaScript number.
 */
export const MAX_MINOR: Minor = 99_999_999_999_999;
const MAX_WHOLE_DIGITS = 12;

/**
 * Parse an amount typed by a person. Accepts Western and Arabic-Indic digits,
 * "." "," and the Arabic decimal separator. Returns `undefined` for an
 * unparsable value or one outside the database range (magnitude above
 * 999,999,999,999.99), and `null` for an empty one (blank). The range is checked
 * on the digits before any number conversion, so an input of any length is safe.
 */
export function parseMadInput(raw: string | null | undefined): Blank<Minor> | undefined {
  if (raw === null || raw === undefined) return null;
  const normalized = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
    .replace(/[\s٬]/g, "");
  if (normalized === "") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return undefined;
  const wholeDigits = (match[2] ?? "").replace(/^0+(?=\d)/, "");
  if (wholeDigits.length > MAX_WHOLE_DIGITS) return undefined;
  const minor = toMinor(`${match[1]}${wholeDigits}${match[3] === undefined ? "" : `.${match[3]}`}`);
  if (Math.abs(minor) > MAX_MINOR) return undefined;
  return minor === 0 ? 0 : minor; // "-0" is a plain zero
}
