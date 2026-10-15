/**
 * Outbound sync policy resolution and External Timezone scheduling (§12.7/§12.8).
 *
 * Pure functions only: which policy applies (global default vs per-Store
 * override), which Remote Sync Status an entry receives, and when the next
 * permitted send time is. All schedule math is evaluated in the one
 * system-wide External Timezone; no external date library is used — the
 * helpers below convert between UTC instants and wall-clock times in an
 * IANA zone via Intl, including DST edge handling.
 */

/** §12.8 policy modes. Review never bypasses the schedule. */
export const SYNC_POLICY_MODES = [
  'immediate',
  'scheduled',
  'review_then_immediate',
  'review_then_scheduled',
] as const;

export type SyncPolicyMode = (typeof SYNC_POLICY_MODES)[number];

export type SyncPolicyKind = 'initial' | 'revision';

export interface SyncPolicyDefaults {
  initial: SyncPolicyMode;
  revision: SyncPolicyMode;
}

/** Per-Store override shape (Store.shippingPolicyOverride); partial by kind. */
export interface SyncPolicyOverride {
  initial?: SyncPolicyMode;
  revision?: SyncPolicyMode;
}

/**
 * §12.7 schedule rule components. `workdaysOnly` restricts to Mon–Fri;
 * holiday calendars are out of the first release. `daysOfWeek` (0=Sunday)
 * further restricts when set. `fixedTime` (daily "HH:mm") wins over the
 * daytime window when both are present.
 */
export interface OutboundScheduleConfig {
  fixedTime?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  daysOfWeek?: number[] | null;
  workdaysOnly?: boolean;
}

export const DEFAULT_OUTBOUND_SCHEDULE: OutboundScheduleConfig = {
  fixedTime: null,
  windowStart: '09:00',
  windowEnd: '18:00',
  daysOfWeek: null,
  workdaysOnly: true,
};

/** Remote Sync Status values an entry can receive (§12.1 subset for M4b). */
export type EntrySyncStatus = 'pending_review' | 'scheduled' | 'not_applicable';

export class InvalidScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScheduleError';
  }
}

export function isSyncPolicyMode(value: unknown): value is SyncPolicyMode {
  return (
    typeof value === 'string' &&
    (SYNC_POLICY_MODES as readonly string[]).includes(value)
  );
}

/**
 * §12.8: each policy has a global default and a per-Store override; the
 * override wins per kind (initial / revision).
 */
export function resolveSyncPolicy(
  defaults: SyncPolicyDefaults,
  override: SyncPolicyOverride | null | undefined,
  kind: SyncPolicyKind,
): SyncPolicyMode {
  const overridden = override?.[kind];
  if (overridden !== undefined) {
    if (!isSyncPolicyMode(overridden)) {
      throw new InvalidScheduleError(`Invalid ${kind} policy override.`);
    }
    return overridden;
  }
  return defaults[kind];
}

// ---------------------------------------------------------------------------
// Timezone helpers (UTC instant <-> wall clock in an IANA zone)
// ---------------------------------------------------------------------------

const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sunday .. 6=Saturday
}

function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new InvalidScheduleError(`Unknown timezone: ${timeZone}`);
  }
}

/** Wall-clock parts of a UTC instant as seen in `timeZone`. */
function wallParts(date: Date, timeZone: string): WallParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  // Hour 24 can appear for midnight with hour12:false in older runtimes.
  const hour = Number(parts.hour) % 24;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: weekdays.indexOf(parts.weekday),
  };
}

/** Offset (ms) to add to a UTC instant to obtain the zone's wall time. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = wallParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - (date.getTime() - date.getTime() % 60000);
}

/** UTC instant for a wall-clock time in `timeZone` (DST-safe, 2 passes). */
function fromWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - zoneOffsetMs(new Date(guess), timeZone);
  result = guess - zoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

function parseClock(value: string, label: string): { hour: number; minute: number } {
  const match = TIME_FORMAT.exec(value);
  if (!match) throw new InvalidScheduleError(`${label} must be HH:mm (24h).`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Throws on malformed schedule shapes (§12.7 rule validation). */
export function validateScheduleConfig(schedule: OutboundScheduleConfig): void {
  if (schedule.fixedTime != null) parseClock(schedule.fixedTime, 'fixedTime');
  if (schedule.windowStart != null) parseClock(schedule.windowStart, 'windowStart');
  if (schedule.windowEnd != null) parseClock(schedule.windowEnd, 'windowEnd');
  if (schedule.windowStart != null && schedule.windowEnd != null) {
    const start = parseClock(schedule.windowStart, 'windowStart');
    const end = parseClock(schedule.windowEnd, 'windowEnd');
    if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
      throw new InvalidScheduleError('windowEnd must be after windowStart.');
    }
  }
  if (schedule.daysOfWeek != null) {
    if (
      !Array.isArray(schedule.daysOfWeek) ||
      schedule.daysOfWeek.length === 0 ||
      schedule.daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    ) {
      throw new InvalidScheduleError('daysOfWeek must be integers 0-6 (0=Sunday).');
    }
  }
}

function dayAllowed(
  weekday: number,
  schedule: OutboundScheduleConfig,
): boolean {
  if (schedule.workdaysOnly && (weekday === 0 || weekday === 6)) return false;
  if (schedule.daysOfWeek && !schedule.daysOfWeek.includes(weekday)) return false;
  return true;
}

/**
 * Next permitted outbound send instant at or after `from`, evaluated in the
 * External Timezone (§12.7). Inside the allowed window the current instant
 * is returned; otherwise the next window start (or fixed time) on the next
 * allowed day.
 */
export function computeNextSendTime(
  schedule: OutboundScheduleConfig,
  from: Date,
  timeZone: string,
): Date {
  validateScheduleConfig(schedule);
  assertValidTimeZone(timeZone);

  const now = wallParts(from, timeZone);
  const minutesNow = now.hour * 60 + now.minute;

  if (schedule.fixedTime != null) {
    const fixed = parseClock(schedule.fixedTime, 'fixedTime');
    let parts = now;
    let candidate = fromWallTime(
      parts.year, parts.month, parts.day, fixed.hour, fixed.minute, timeZone,
    );
    // Today's slot already passed: move to the next calendar day first.
    if (candidate.getTime() <= from.getTime()) {
      parts = wallParts(new Date(candidate.getTime() + 24 * 3600 * 1000), timeZone);
      candidate = fromWallTime(
        parts.year, parts.month, parts.day, fixed.hour, fixed.minute, timeZone,
      );
    }
    // Skip disallowed weekdays (bounded; a full week always contains an
    // allowed day for valid configs).
    let guard = 0;
    while (!dayAllowed(parts.weekday, schedule) && guard < 8) {
      parts = wallParts(new Date(candidate.getTime() + 24 * 3600 * 1000), timeZone);
      candidate = fromWallTime(
        parts.year, parts.month, parts.day, fixed.hour, fixed.minute, timeZone,
      );
      guard += 1;
    }
    return candidate;
  }

  const windowStart =
    schedule.windowStart != null
      ? parseClock(schedule.windowStart, 'windowStart')
      : { hour: 0, minute: 0 };
  const windowEnd =
    schedule.windowEnd != null
      ? parseClock(schedule.windowEnd, 'windowEnd')
      : { hour: 23, minute: 59 };
  const startMinutes = windowStart.hour * 60 + windowStart.minute;
  const endMinutes = windowEnd.hour * 60 + windowEnd.minute;

  // Inside the window on an allowed day: eligible right now.
  if (dayAllowed(now.weekday, schedule) && minutesNow >= startMinutes && minutesNow < endMinutes) {
    return from;
  }

  let { year, month, day, weekday } = now;
  let candidate = fromWallTime(year, month, day, windowStart.hour, windowStart.minute, timeZone);
  let attempts = 0;
  while (
    attempts < 8 &&
    (!dayAllowed(weekday, schedule) || candidate.getTime() <= from.getTime())
  ) {
    candidate = new Date(candidate.getTime() + 24 * 3600 * 1000);
    ({ year, month, day, weekday } = wallParts(candidate, timeZone));
    candidate = fromWallTime(year, month, day, windowStart.hour, windowStart.minute, timeZone);
    attempts += 1;
  }
  return candidate;
}

export interface EntryEvaluation {
  remoteSyncStatus: EntrySyncStatus;
  nextSendAt: Date | null;
}

/**
 * Applies the resolved policy to a freshly entered Shipment (§12.8).
 * Immediate execution is represented as `scheduled` with nextSendAt = now —
 * the worker picks it up on its next tick; review-required entries wait in
 * `pending_review` until approved (approval recomputes the schedule; it
 * never bypasses it).
 */
export function evaluateOutboundEntry(
  policy: SyncPolicyMode,
  schedule: OutboundScheduleConfig,
  now: Date,
  timeZone: string,
): EntryEvaluation {
  switch (policy) {
    case 'immediate':
      return { remoteSyncStatus: 'scheduled', nextSendAt: now };
    case 'scheduled':
      return {
        remoteSyncStatus: 'scheduled',
        nextSendAt: computeNextSendTime(schedule, now, timeZone),
      };
    case 'review_then_immediate':
    case 'review_then_scheduled':
      return { remoteSyncStatus: 'pending_review', nextSendAt: null };
  }
}
