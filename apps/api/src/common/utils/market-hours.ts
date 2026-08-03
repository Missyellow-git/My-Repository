import { MARKET_HOURS_IST } from '@fundlens/shared';

/**
 * NSE/BSE cash-segment session helpers, evaluated in IST regardless of where
 * the server runs. Containers run in UTC; deriving IST from the wall clock
 * would silently break the price-refresh scheduler on any host whose timezone
 * is not Asia/Kolkata.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

export interface IstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
  /** YYYY-MM-DD in IST. */
  dateKey: string;
}

export function toIst(date: Date = new Date()): IstParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    year,
    month,
    day,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function minutesOfDay(p: IstParts): number {
  return p.hour * 60 + p.minute;
}

/**
 * @param holidayKeys Set of `YYYY-MM-DD` exchange holidays, loaded from the
 *   MarketHoliday table by MarketCalendarService. Passing an empty set treats
 *   every weekday as a trading day, which is the safe default: we over-fetch
 *   rather than go dark on a day the exchange is actually open.
 */
export function isTradingDay(
  date: Date = new Date(),
  holidayKeys: ReadonlySet<string> = new Set(),
): boolean {
  const p = toIst(date);
  if (!(MARKET_HOURS_IST.tradingDays as readonly number[]).includes(p.weekday)) return false;
  return !holidayKeys.has(p.dateKey);
}

export function isMarketOpen(
  date: Date = new Date(),
  holidayKeys: ReadonlySet<string> = new Set(),
): boolean {
  if (!isTradingDay(date, holidayKeys)) return false;
  const now = minutesOfDay(toIst(date));
  const open = MARKET_HOURS_IST.open.hour * 60 + MARKET_HOURS_IST.open.minute;
  const close = MARKET_HOURS_IST.close.hour * 60 + MARKET_HOURS_IST.close.minute;
  return now >= open && now <= close;
}

/**
 * True in the ~15 minutes after the close, when we keep polling once more so
 * the closing print lands in our cache instead of a 15:29 tick.
 */
export function isPostCloseSettlingWindow(
  date: Date = new Date(),
  holidayKeys: ReadonlySet<string> = new Set(),
): boolean {
  if (!isTradingDay(date, holidayKeys)) return false;
  const now = minutesOfDay(toIst(date));
  const close = MARKET_HOURS_IST.close.hour * 60 + MARKET_HOURS_IST.close.minute;
  return now > close && now <= close + 15;
}

/** Last calendar day of the month `monthsAgo` months before `from`, in UTC. */
export function monthEndUtc(from: Date, monthsAgo = 0): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - monthsAgo + 1, 0));
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
