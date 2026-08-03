import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formatting helpers.
 *
 * Everything money-shaped uses the en-IN locale so figures group in the Indian
 * lakh/crore convention (1,23,456 rather than 123,456) — the wrong grouping is
 * immediately jarring to the audience this product is for.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_COMPACT = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return INR.format(value);
}

export function formatNumber(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function formatPercent(value: number | null | undefined, dp = 2, withSign = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = withSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(dp)}%`;
}

/**
 * Market capitalisation in Indian units. Values are stored in crore; anything
 * at or above a lakh crore is shown in lakh crore, which is how the number is
 * actually spoken.
 */
export function formatMarketCap(crore: number | null | undefined): string {
  if (crore === null || crore === undefined || !Number.isFinite(crore)) return '—';
  if (crore >= 100_000) return `₹${INR_COMPACT.format(crore / 100_000)} L cr`;
  if (crore >= 1) return `₹${INR_COMPACT.format(crore)} cr`;
  return `₹${INR_COMPACT.format(crore * 100)} L`;
}

export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 10_000_000) return `${(value / 10_000_000).toFixed(2)} cr`;
  if (value >= 100_000) return `${(value / 100_000).toFixed(2)} L`;
  return value.toLocaleString('en-IN');
}

/** "31 Jul 2025" — unambiguous for an audience that writes both DD/MM and MM/DD. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** Directional class for a change value. Null renders neutral, not green. */
export function changeClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'text-flat';
  if (value > 0) return 'text-gain';
  if (value < 0) return 'text-loss';
  return 'text-flat';
}

/** Deterministic chart colours, cycled by index. */
export const CHART_COLORS = [
  'hsl(221 83% 53%)',
  'hsl(142 71% 40%)',
  'hsl(38 92% 50%)',
  'hsl(280 65% 60%)',
  'hsl(199 89% 48%)',
  'hsl(0 72% 55%)',
  'hsl(160 60% 42%)',
  'hsl(24 90% 55%)',
  'hsl(262 60% 62%)',
  'hsl(180 60% 40%)',
  'hsl(330 70% 58%)',
  'hsl(90 55% 45%)',
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}
