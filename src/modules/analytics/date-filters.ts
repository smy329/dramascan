/**
 * Analytics date filters (Prompt 145).
 *
 * The dashboard stores every timestamp in UTC and interprets every calendar
 * day in `Asia/Dhaka` (UTC+06:00). The two are different things: a row written
 * at `2026-11-24T20:30:00Z` is stored in UTC, but in Dhaka it is already
 * `2026-11-25 02:30`, so it belongs to the 25th, not the 24th.
 *
 * These helpers are pure and have no database dependency, so they can be
 * unit-tested without a database and reused by the dashboard, the API, and the
 * aggregation command.
 */

/** The dashboard's display timezone. */
export const DASHBOARD_TIME_ZONE = 'Asia/Dhaka';

/** The fixed offset of `Asia/Dhaka` in minutes. Bangladesh has no DST. */
export const DASHBOARD_UTC_OFFSET_MINUTES = 6 * 60;

/** The approved date-range presets. */
export const DATE_RANGE_PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
  'custom',
] as const;

/** One approved date-range preset. */
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

/**
 * Is this an approved date-range preset?
 *
 * The dashboard takes the preset from the URL, so the value is untrusted: an
 * unknown preset falls back to the default range instead of reaching a query.
 *
 * @param value the candidate
 * @returns whether the candidate is an approved preset
 */
export function isDateRangePreset(value: string): value is DateRangePreset {
  return (DATE_RANGE_PRESETS as readonly string[]).includes(value);
}

/** The longest range a query may cover. */
export const MAX_RANGE_DAYS = 366;

/**
 * The `YYYY-MM-DD` day a UTC instant falls on in `Asia/Dhaka`.
 *
 * `String.prototype.substring` on a `YYYY-MM-DDTHH:mm:ss.sssZ` string always
 * produces exactly ten characters, so the result is never undefined.
 *
 * @param instant the UTC instant
 * @returns the Dhaka calendar day as `YYYY-MM-DD`
 */
export function dhakaDateString(instant: Date): string {
  const shifted = new Date(instant.getTime() + DASHBOARD_UTC_OFFSET_MINUTES * 60 * 1000);

  return shifted.toISOString().substring(0, 10);
}

/**
 * The UTC hour bucket an instant falls into.
 *
 * The bucket is the `YYYY-MM-DDTHH` string of the instant in UTC. It is the
 * grouping key of the analytics event tables: the deduplication indexes and
 * the aggregation queries both use it, so every writer has to produce exactly
 * the same string for the same instant.
 *
 * @param instant the UTC instant
 * @returns the bucket, for example `2026-11-24T20`
 */
export function utcHourBucket(instant: Date): string {
  return instant.toISOString().substring(0, 13);
}

/**
 * Parse a `YYYY-MM-DD` string into the UTC instant that starts that Dhaka day.
 *
 * A Dhaka day starts at `00:00 +06:00`, which is `18:00` UTC on the previous
 * calendar day.
 *
 * @param day the `YYYY-MM-DD` day
 * @returns the UTC instant of the start of that Dhaka day
 */
export function startOfDhakaDay(day: string): Date {
  const midnightUtc = new Date(`${day}T00:00:00.000Z`);

  return new Date(midnightUtc.getTime() - DASHBOARD_UTC_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Parse a `YYYY-MM-DD` string into the UTC instant that ends that Dhaka day.
 *
 * The end is exclusive: it is the start of the next Dhaka day.
 *
 * @param day the `YYYY-MM-DD` day
 * @returns the exclusive UTC instant of the end of that Dhaka day
 */
export function endOfDhakaDay(day: string): Date {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);

  return new Date(next.getTime() - DASHBOARD_UTC_OFFSET_MINUTES * 60 * 1000);
}

/** A resolved date range. */
export type DateRange = Readonly<{
  /** The first day of the range, as `YYYY-MM-DD` in Dhaka. */
  startDate: string;
  /** The last day of the range, as `YYYY-MM-DD` in Dhaka. */
  endDate: string;
  /** The exclusive UTC instant the range starts at. */
  startInstant: Date;
  /** The exclusive UTC instant the range ends at. */
  endInstant: Date;
  /** How many days the range covers. */
  dayCount: number;
  /** The preset the range was derived from, or `custom`. */
  preset: DateRangePreset;
}>;

/**
 * Add a number of days to a `YYYY-MM-DD` day.
 *
 * @param day the starting day
 * @param days how many days to add (may be negative)
 * @returns the resulting day
 */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().substring(0, 10);
}

/**
 * The first day of the month a `YYYY-MM-DD` day falls in.
 */
export function startOfMonth(day: string): string {
  return `${day.substring(0, 7)}-01`;
}

/**
 * The last day of the month a `YYYY-MM-DD` day falls in.
 */
export function endOfMonth(day: string): string {
  const date = new Date(`${startOfMonth(day)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().substring(0, 10);
}

/**
 * Resolve a date-range preset into a concrete range.
 *
 * @param preset the approved preset
 * @param now the reference instant (defaults to the current time)
 * @returns the resolved range
 */
export function resolveDateRange(
  preset: DateRangePreset,
  now: Date = new Date()
): DateRange {
  const today = dhakaDateString(now);

  let startDate: string;
  let endDate: string;
  let resolvedPreset: DateRangePreset = preset;

  switch (preset) {
    case 'today':
      startDate = today;
      endDate = today;
      break;
    case 'yesterday':
      startDate = addDays(today, -1);
      endDate = addDays(today, -1);
      break;
    case 'last_7_days':
      startDate = addDays(today, -6);
      endDate = today;
      break;
    case 'last_30_days':
      startDate = addDays(today, -29);
      endDate = today;
      break;
    case 'last_90_days':
      startDate = addDays(today, -89);
      endDate = today;
      break;
    case 'this_month':
      startDate = startOfMonth(today);
      endDate = today;
      break;
    case 'last_month': {
      const previousMonthDay = addDays(startOfMonth(today), -1);
      startDate = startOfMonth(previousMonthDay);
      endDate = endOfMonth(previousMonthDay);
      break;
    }
    case 'custom':
      startDate = today;
      endDate = today;
      break;
    default:
      // An unvalidated preset can only arrive from a cast. Fall back to the
      // default range instead of building an unbounded one.
      resolvedPreset = 'last_7_days';
      startDate = addDays(today, -6);
      endDate = today;
      break;
  }

  return buildDateRange(startDate, endDate, resolvedPreset);
}

/**
 * Build a range from two explicit days, validating the result.
 *
 * A range must be ordered, must not be empty, and must not exceed
 * `MAX_RANGE_DAYS`. An unrestricted query is exactly what the dashboard must
 * never run.
 */
export function buildDateRange(
  startDate: string,
  endDate: string,
  preset: DateRangePreset = 'custom'
): DateRange {
  const dayCount = daysBetween(startDate, endDate) + 1;

  if (dayCount < 1) {
    throw new RangeError('The start date must not be after the end date.');
  }

  if (dayCount > MAX_RANGE_DAYS) {
    throw new RangeError(
      `The date range covers ${dayCount} days, which exceeds the ${MAX_RANGE_DAYS}-day limit.`
    );
  }

  return {
    startDate,
    endDate,
    startInstant: startOfDhakaDay(startDate),
    endInstant: endOfDhakaDay(endDate),
    dayCount,
    preset,
  };
}

/**
 * How many days lie between two `YYYY-MM-DD` days, inclusive of both ends.
 *
 * @returns the number of days
 */
export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();

  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/**
 * Is this a well-formed `YYYY-MM-DD` day?
 *
 * @param value the candidate
 * @returns `true` when the value is a real calendar day
 */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().substring(0, 10) === value;
}

/**
 * Every `YYYY-MM-DD` day in a range, oldest first.
 *
 * @param range the resolved range
 * @returns the days in the range
 */
export function eachDay(range: DateRange): string[] {
  const days: string[] = [];

  for (let index = 0; index < range.dayCount; index += 1) {
    days.push(addDays(range.startDate, index));
  }

  return days;
}

/**
 * The human-readable label of a preset, for the dashboard's filter control.
 */
export const DATE_RANGE_PRESET_LABELS: Readonly<Record<DateRangePreset, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 Days',
  last_30_days: 'Last 30 Days',
  last_90_days: 'Last 90 Days',
  this_month: 'This Month',
  last_month: 'Last Month',
  custom: 'Custom Range',
};
