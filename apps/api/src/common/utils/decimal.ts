import { Prisma } from '@prisma/client';

/**
 * Prisma returns Decimal columns as `Decimal` objects and BigInt columns as
 * `bigint`, neither of which survives `JSON.stringify`. Every value that leaves
 * a service towards a controller goes through these helpers so serialisation
 * happens in exactly one place and rounding is explicit rather than incidental.
 */

export type MaybeDecimal = Prisma.Decimal | number | string | null | undefined;

export function toNum(value: MaybeDecimal): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/** Same as `toNum` but never null — for columns declared NOT NULL. */
export function toNumOr(value: MaybeDecimal, fallback: number): number {
  return toNum(value) ?? fallback;
}

export function toBigIntNum(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'bigint' ? Number(value) : value;
}

/**
 * Rounds half-away-from-zero to `dp` places.
 *
 * The `r === 0` guard matters: a tiny negative input (-0.0001 at 2dp) would
 * otherwise round to `-0`, which serialises as `-0` in JSON and renders as
 * "-0.00%" in the UI — a change that reads as a loss when there was none.
 */
export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  const r = Math.round(Math.abs(value) * f) / f;
  if (r === 0) return 0;
  return value < 0 ? -r : r;
}

export function roundOrNull(value: number | null | undefined, dp = 2): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : round(value, dp);
}

/** Percentage change from `from` to `to`; null when `from` is absent or zero. */
export function pctChange(to: number | null, from: number | null): number | null {
  if (to === null || from === null || from === 0) return null;
  return round(((to - from) / from) * 100, 4);
}

/**
 * Weighted mean that ignores entries with a null value, and returns null rather
 * than 0 when nothing is measurable — a portfolio where no price arrived has an
 * *unknown* average move, not a flat one, and the UI renders those differently.
 */
export function weightedMean(
  entries: Array<{ weight: number; value: number | null }>,
  dp = 4,
): number | null {
  let weightSum = 0;
  let acc = 0;
  for (const { weight, value } of entries) {
    if (value === null || !Number.isFinite(value) || weight <= 0) continue;
    acc += weight * value;
    weightSum += weight;
  }
  return weightSum === 0 ? null : round(acc / weightSum, dp);
}

export function mean(values: Array<number | null>, dp = 4): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return null;
  return round(present.reduce((a, b) => a + b, 0) / present.length, dp);
}

export function sum(values: Array<number | null>, dp = 4): number {
  return round(
    values.reduce<number>((a, b) => a + (b === null || !Number.isFinite(b) ? 0 : b), 0),
    dp,
  );
}
