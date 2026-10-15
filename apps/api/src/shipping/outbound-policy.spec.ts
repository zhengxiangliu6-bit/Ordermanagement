import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OUTBOUND_SCHEDULE,
  InvalidScheduleError,
  computeNextSendTime,
  evaluateOutboundEntry,
  resolveSyncPolicy,
  validateScheduleConfig,
} from './outbound-policy';

const SHANGHAI = 'Asia/Shanghai';

describe('resolveSyncPolicy (§12.8)', () => {
  const defaults = {
    initial: 'immediate' as const,
    revision: 'review_then_scheduled' as const,
  };

  it('uses the global defaults without an override', () => {
    expect(resolveSyncPolicy(defaults, null, 'initial')).toBe('immediate');
    expect(resolveSyncPolicy(defaults, undefined, 'revision')).toBe(
      'review_then_scheduled',
    );
  });

  it('the per-Store override wins per kind and partial overrides fall back', () => {
    const override = { initial: 'scheduled' as const };
    expect(resolveSyncPolicy(defaults, override, 'initial')).toBe('scheduled');
    expect(resolveSyncPolicy(defaults, override, 'revision')).toBe(
      'review_then_scheduled',
    );
  });

  it('rejects an invalid override value', () => {
    expect(() =>
      resolveSyncPolicy(defaults, { initial: 'whenever' as never }, 'initial'),
    ).toThrow(InvalidScheduleError);
  });
});

describe('validateScheduleConfig', () => {
  it('accepts the default schedule', () => {
    expect(() => validateScheduleConfig(DEFAULT_OUTBOUND_SCHEDULE)).not.toThrow();
  });

  it('rejects malformed clock values', () => {
    expect(() =>
      validateScheduleConfig({ windowStart: '9:00', windowEnd: '18:00' }),
    ).toThrow(InvalidScheduleError);
    expect(() =>
      validateScheduleConfig({ windowStart: '25:00', windowEnd: '26:00' }),
    ).toThrow(InvalidScheduleError);
  });

  it('rejects an empty or inverted window', () => {
    expect(() =>
      validateScheduleConfig({ windowStart: '18:00', windowEnd: '09:00' }),
    ).toThrow(InvalidScheduleError);
    expect(() =>
      validateScheduleConfig({ windowStart: '09:00', windowEnd: '09:00' }),
    ).toThrow(InvalidScheduleError);
  });

  it('rejects invalid weekday numbers', () => {
    expect(() => validateScheduleConfig({ daysOfWeek: [1, 7] })).toThrow(
      InvalidScheduleError,
    );
    expect(() => validateScheduleConfig({ daysOfWeek: [] })).toThrow(
      InvalidScheduleError,
    );
  });
});

describe('computeNextSendTime (§12.7, External Timezone)', () => {
  const schedule = { ...DEFAULT_OUTBOUND_SCHEDULE }; // 09:00-18:00, workdays only

  it('returns the current instant when inside the window on an allowed day', () => {
    // 2026-10-12 10:00 Asia/Shanghai (Monday)
    const from = new Date('2026-10-12T02:00:00Z');
    expect(computeNextSendTime(schedule, from, SHANGHAI).getTime()).toBe(
      from.getTime(),
    );
  });

  it('before the window: same day at window start', () => {
    // 2026-10-12 08:30 CST (Monday) -> 09:00 CST = 01:00Z
    const from = new Date('2026-10-12T00:30:00Z');
    expect(computeNextSendTime(schedule, from, SHANGHAI).toISOString()).toBe(
      '2026-10-12T01:00:00.000Z',
    );
  });

  it('after the window on Friday: Monday window start (weekend excluded)', () => {
    // 2026-10-09 19:00 CST (Friday evening)
    const from = new Date('2026-10-09T11:00:00Z');
    expect(computeNextSendTime(schedule, from, SHANGHAI).toISOString()).toBe(
      '2026-10-12T01:00:00.000Z',
    );
  });

  it('weekend inside the daily window still waits for the next workday', () => {
    // 2026-10-10 10:00 CST (Saturday)
    const from = new Date('2026-10-10T02:00:00Z');
    expect(computeNextSendTime(schedule, from, SHANGHAI).toISOString()).toBe(
      '2026-10-12T01:00:00.000Z',
    );
  });

  it('honors daysOfWeek when set (Mon/Wed/Fri only)', () => {
    const custom = {
      windowStart: '09:00',
      windowEnd: '18:00',
      daysOfWeek: [1, 3, 5],
      workdaysOnly: false,
    };
    // 2026-10-14 19:00 CST (Wednesday evening) -> Friday 09:00 CST
    const from = new Date('2026-10-14T11:00:00Z');
    expect(computeNextSendTime(custom, from, SHANGHAI).toISOString()).toBe(
      '2026-10-16T01:00:00.000Z',
    );
  });

  it('fixed time already passed today moves to tomorrow', () => {
    const custom = { fixedTime: '17:30', workdaysOnly: true };
    // 2026-10-12 18:00 CST (Monday) -> Tuesday 17:30 CST
    const from = new Date('2026-10-12T10:00:00Z');
    expect(computeNextSendTime(custom, from, SHANGHAI).toISOString()).toBe(
      '2026-10-13T09:30:00.000Z',
    );
  });

  it('fixed time later today stays today', () => {
    const custom = { fixedTime: '17:30', workdaysOnly: true };
    // 2026-10-12 10:00 CST (Monday) -> same day 17:30 CST
    const from = new Date('2026-10-12T02:00:00Z');
    expect(computeNextSendTime(custom, from, SHANGHAI).toISOString()).toBe(
      '2026-10-12T09:30:00.000Z',
    );
  });

  it('fixed time on a weekend skips to Monday', () => {
    const custom = { fixedTime: '17:30', workdaysOnly: true };
    // 2026-10-10 18:00 CST (Saturday) -> Monday 17:30 CST
    const from = new Date('2026-10-10T10:00:00Z');
    expect(computeNextSendTime(custom, from, SHANGHAI).toISOString()).toBe(
      '2026-10-12T09:30:00.000Z',
    );
  });

  it('is DST-aware across a spring-forward transition (America/New_York)', () => {
    // DST starts 2026-03-08 02:00 EST. Saturday afternoon after the window.
    const from = new Date('2026-03-07T20:00:00Z'); // 15:00 Sat EST
    expect(
      computeNextSendTime(schedule, from, 'America/New_York').toISOString(),
    ).toBe('2026-03-09T13:00:00.000Z'); // Monday 09:00 EDT = 13:00Z, not 14:00Z
  });

  it('crosses the spring-forward day itself correctly', () => {
    // 2026-03-08 11:00 EST (Sunday, disallowed) -> Monday 09:00 EDT
    const from = new Date('2026-03-08T15:00:00Z');
    expect(
      computeNextSendTime(schedule, from, 'America/New_York').toISOString(),
    ).toBe('2026-03-09T13:00:00.000Z');
  });

  it('throws on an unknown timezone', () => {
    expect(() =>
      computeNextSendTime(schedule, new Date(), 'Mars/Olympus'),
    ).toThrow(InvalidScheduleError);
  });
});

describe('evaluateOutboundEntry (§12.8)', () => {
  const schedule = { ...DEFAULT_OUTBOUND_SCHEDULE };
  // Monday 10:00 CST, inside the window.
  const now = new Date('2026-10-12T02:00:00Z');

  it('immediate schedules for right now', () => {
    const result = evaluateOutboundEntry('immediate', schedule, now, SHANGHAI);
    expect(result.remoteSyncStatus).toBe('scheduled');
    expect(result.nextSendAt?.getTime()).toBe(now.getTime());
  });

  it('scheduled computes the next permitted time', () => {
    // Monday 19:00 CST would be after the window; use an after-window instant.
    const late = new Date('2026-10-12T12:00:00Z');
    const result = evaluateOutboundEntry('scheduled', schedule, late, SHANGHAI);
    expect(result.remoteSyncStatus).toBe('scheduled');
    expect(result.nextSendAt?.toISOString()).toBe('2026-10-13T01:00:00.000Z');
  });

  it('review-required policies wait in pending_review without a send time', () => {
    for (const mode of ['review_then_immediate', 'review_then_scheduled'] as const) {
      const result = evaluateOutboundEntry(mode, schedule, now, SHANGHAI);
      expect(result.remoteSyncStatus).toBe('pending_review');
      expect(result.nextSendAt).toBeNull();
    }
  });
});
