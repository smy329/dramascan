import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_UTC_OFFSET_MINUTES,
  MAX_RANGE_DAYS,
  addDays,
  buildDateRange,
  daysBetween,
  dhakaDateString,
  eachDay,
  endOfDhakaDay,
  endOfMonth,
  isCalendarDay,
  isDateRangePreset,
  resolveDateRange,
  startOfDhakaDay,
  startOfMonth,
  utcHourBucket,
} from '@/modules/analytics/date-filters';

/**
 * Analytics date helper coverage (Prompts 140, 143, 145).
 *
 * The dashboard stores every timestamp in UTC and reads every calendar day in
 * `Asia/Dhaka`. These helpers are the boundary between the two, so they are
 * pure and unit-tested without a database.
 */

describe('dhakaDateString', () => {
  it('returns the Dhaka calendar day of a UTC instant', () => {
    // 20:30 UTC is already the next day in Dhaka (UTC+06:00).
    expect(dhakaDateString(new Date('2026-11-24T20:30:00.000Z'))).toBe('2026-11-25');
  });

  it('keeps an instant that belongs to the same Dhaka day', () => {
    expect(dhakaDateString(new Date('2026-11-24T17:59:59.999Z'))).toBe('2026-11-24');
  });

  it('uses the fixed Dhaka offset', () => {
    expect(DASHBOARD_UTC_OFFSET_MINUTES).toBe(360);
  });
});

describe('utcHourBucket', () => {
  it('formats the UTC hour of an instant', () => {
    expect(utcHourBucket(new Date('2026-11-24T20:30:00.000Z'))).toBe('2026-11-24T20');
  });

  it('is stable across the minutes of one hour', () => {
    expect(utcHourBucket(new Date('2026-11-24T20:00:00.000Z'))).toBe(
      utcHourBucket(new Date('2026-11-24T20:59:59.999Z'))
    );
  });

  it('changes when the UTC hour changes', () => {
    expect(utcHourBucket(new Date('2026-11-24T20:59:59.999Z'))).not.toBe(
      utcHourBucket(new Date('2026-11-24T21:00:00.000Z'))
    );
  });
});

describe('resolveDateRange', () => {
  const now = new Date('2026-11-24T12:00:00.000Z');

  it('resolves today to the current Dhaka day', () => {
    const range = resolveDateRange('today', now);
    expect(range.startDate).toBe('2026-11-24');
    expect(range.endDate).toBe('2026-11-24');
    expect(range.dayCount).toBe(1);
  });

  it('resolves yesterday to the previous Dhaka day', () => {
    const range = resolveDateRange('yesterday', now);
    expect(range.startDate).toBe('2026-11-23');
    expect(range.endDate).toBe('2026-11-23');
  });

  it('resolves the last seven days to seven days ending today', () => {
    const range = resolveDateRange('last_7_days', now);
    expect(range.startDate).toBe('2026-11-18');
    expect(range.endDate).toBe('2026-11-24');
    expect(range.dayCount).toBe(7);
  });

  it('resolves the last thirty days to thirty days ending today', () => {
    const range = resolveDateRange('last_30_days', now);
    expect(range.dayCount).toBe(30);
  });

  it('resolves the last ninety days to ninety days ending today', () => {
    const range = resolveDateRange('last_90_days', now);
    expect(range.dayCount).toBe(90);
  });

  it('resolves this month from the first of the month to today', () => {
    const range = resolveDateRange('this_month', now);
    expect(range.startDate).toBe('2026-11-01');
    expect(range.endDate).toBe('2026-11-24');
  });

  it('resolves last month to the whole previous month', () => {
    const range = resolveDateRange('last_month', now);
    expect(range.startDate).toBe('2026-10-01');
    expect(range.endDate).toBe('2026-10-31');
    expect(range.dayCount).toBe(31);
  });
});

describe('buildDateRange', () => {
  it('rejects a range whose start is after its end', () => {
    expect(() => buildDateRange('2026-11-24', '2026-11-23')).toThrow(RangeError);
  });

  it('rejects a range longer than the maximum', () => {
    expect(() => buildDateRange('2025-01-01', '2026-11-24')).toThrow(RangeError);
  });

  it('accepts a range of exactly the maximum length', () => {
    const range = buildDateRange('2025-11-24', '2026-11-24');
    expect(range.dayCount).toBe(MAX_RANGE_DAYS);
  });

  it('produces UTC instants that match the Dhaka day boundaries', () => {
    const range = buildDateRange('2026-11-24', '2026-11-24');
    expect(range.startInstant.toISOString()).toBe('2026-11-23T18:00:00.000Z');
    expect(range.endInstant.toISOString()).toBe('2026-11-24T18:00:00.000Z');
  });
});

describe('day helpers', () => {
  it('adds and subtracts days across a month boundary', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-01', -1)).toBe('2026-11-30');
  });

  it('counts the days between two days inclusively', () => {
    expect(daysBetween('2026-11-24', '2026-11-24')).toBe(0);
    expect(daysBetween('2026-11-24', '2026-11-26')).toBe(2);
  });

  it('finds the first and last day of a month', () => {
    expect(startOfMonth('2026-11-24')).toBe('2026-11-01');
    expect(endOfMonth('2026-11-24')).toBe('2026-11-30');
  });

  it('lists every day of a range', () => {
    const range = buildDateRange('2026-11-23', '2026-11-25');
    expect(eachDay(range)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
  });

  it('recognises real calendar days only', () => {
    expect(isCalendarDay('2026-11-24')).toBe(true);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('24-11-2026')).toBe(false);
  });

  it('returns the exclusive end of a Dhaka day', () => {
    expect(endOfDhakaDay('2026-11-24').toISOString()).toBe('2026-11-24T18:00:00.000Z');
    expect(startOfDhakaDay('2026-11-24').toISOString()).toBe('2026-11-23T18:00:00.000Z');
  });
});

describe('isDateRangePreset', () => {
  it('accepts every approved preset', () => {
    for (const preset of [
      'today',
      'yesterday',
      'last_7_days',
      'last_30_days',
      'last_90_days',
      'this_month',
      'last_month',
      'custom',
    ]) {
      expect(isDateRangePreset(preset)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isDateRangePreset('last_year')).toBe(false);
    expect(isDateRangePreset('')).toBe(false);
    expect(isDateRangePreset('TODAY')).toBe(false);
  });
});
