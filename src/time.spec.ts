import { describe, expect, it } from 'vitest';
import { startOfZonedDay, zonedTimeToUtc } from './time.js';

describe('time zones', () => {
  it('keeps a local time just after midnight on that local date', () => {
    const instant = new Date('2026-01-15T05:30:00.000Z');
    const start = startOfZonedDay(instant, 'America/New_York');
    expect(start.toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });

  it('uses the daylight-saving offset on each side of the change', () => {
    const spring = zonedTimeToUtc(2026, 3, 8, 9, 0, 'America/New_York');
    const autumn = zonedTimeToUtc(2026, 11, 1, 9, 0, 'America/New_York');
    expect(spring.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(autumn.toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });
});
